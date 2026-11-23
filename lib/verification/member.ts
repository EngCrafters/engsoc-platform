import "server-only";

import { createHash } from "node:crypto";
import {
  currentDocumentStorage,
  deleteDocumentObject,
  newDocumentKey,
  putDocumentObject,
  type StorageConfig,
} from "@/lib/membership/storage";
import type { DocumentMediaType } from "@/lib/membership/types";
import {
  beginSquThroughRoutine,
  leadershipOptionsThroughRoutine,
  ownLeadershipThroughRoutine,
  ownSquThroughRoutine,
  queueAbandonedSquThroughRoutine,
  requestLeadershipThroughRoutine,
  submitSquThroughRoutine,
} from "./db";
import type { CodeResult } from "./types";

/**
 * The signed-in member's side of ADR 0025: their own verification and roles,
 * SQU evidence submission and leadership requests. The member is always the
 * identity Supabase Auth verified for the request; the routines decide whether
 * they may act, and answer only for them.
 */

export const STUDENT_NUMBER = /^[0-9]{6,10}$/;

/** A refusal names the area it concerns, unless the routine named a field itself. */
export const naming = (result: CodeResult, field: string): CodeResult =>
  result.code === "SUCCESS" ? result : { field, ...result };

/** The two halves load independently, so one failing never hides the other. */
export const ownSquVerification = (actor: string) =>
  ownSquThroughRoutine(actor);
export const ownLeadership = (actor: string) =>
  ownLeadershipThroughRoutine(actor);
export const leadershipOptions = (actor: string) =>
  leadershipOptionsThroughRoutine(actor);
export const requestLeadership = (
  actor: string,
  committee: string,
  team: string | null,
  position: string
) => requestLeadershipThroughRoutine(actor, committee, team, position);

/** Queues an object nothing may reference; the routine refuses a referenced one. */
async function queueAbandoned(bucket: string, key: string) {
  try {
    await queueAbandonedSquThroughRoutine(bucket, key);
  } catch {
    // The key is random and identifies no one; it is what cleanup needs.
    console.error("verification_storage_orphan", { bucket, key });
  }
}

/**
 * SQU evidence, in ADR 0018's order: the database refuses an ineligible member
 * before anything is uploaded, Core stores the object under a random key, and
 * only then does the database write the request with the reference. An object
 * whose request is not written is deleted, or queued for deletion when that
 * cannot be done (or confirmed) at once. Without Storage configured the bytes
 * stay in PostgreSQL, as for ID cards.
 */
export async function submitSquVerification(
  actor: string,
  input: {
    studentNumber: string;
    document: { mediaType: DocumentMediaType; bytes: Uint8Array };
  }
): Promise<CodeResult> {
  const storage = currentDocumentStorage();
  // Half-configured Storage is a deployment error: never fall back silently.
  if (storage.mode === "misconfigured") return { code: "STORAGE_UNAVAILABLE" };
  const begun = await beginSquThroughRoutine(actor);
  if (begun.code !== "SUCCESS") return begun;

  const content = Buffer.from(input.document.bytes);
  const record = {
    studentNumber: input.studentNumber,
    mediaType: input.document.mediaType,
    sha256: createHash("sha256").update(content).digest("hex"),
    byteSize: content.byteLength,
  };
  if (storage.mode === "database") {
    return submitSquThroughRoutine(actor, {
      ...record,
      content,
      storageBucket: null,
      storageKey: null,
    });
  }
  return submitWithStorage(storage.config, actor, record, content);
}

async function submitWithStorage(
  config: StorageConfig,
  actor: string,
  record: {
    studentNumber: string;
    mediaType: DocumentMediaType;
    sha256: string;
    byteSize: number;
  },
  content: Buffer
): Promise<CodeResult> {
  const key = newDocumentKey(record.mediaType, "squ-verification");
  const stored = await putDocumentObject(
    config,
    key,
    content,
    record.mediaType,
    record.sha256
  );
  if (!stored.ok) {
    if (stored.uncertain) await queueAbandoned(config.bucket, key);
    return { code: "STORAGE_UNAVAILABLE" };
  }
  let result: CodeResult;
  try {
    result = await submitSquThroughRoutine(actor, {
      ...record,
      content: null,
      storageBucket: config.bucket,
      storageKey: key,
    });
  } catch (error) {
    // The write may or may not have committed: only the queue, which checks
    // for a reference, may remove the object now.
    await queueAbandoned(config.bucket, key);
    throw error;
  }
  if (result.code !== "SUCCESS") {
    // A refusal returns before anything is written, so nothing references it.
    if (!(await deleteDocumentObject(config, key)))
      await queueAbandoned(config.bucket, key);
  }
  return result;
}
