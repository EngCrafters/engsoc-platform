import "server-only";

import { createHash } from "node:crypto";
import { processMembershipStorageDeletions } from "@/lib/membership/server";
import {
  currentDocumentStorage,
  getDocumentObject,
} from "@/lib/membership/storage";
import { MAX_DOCUMENT_BYTES } from "@/lib/membership/types";
import {
  decideLeadershipThroughRoutine,
  decideSquThroughRoutine,
  getLeadershipThroughRoutine,
  getSquThroughRoutine,
  leadershipFiltersThroughRoutine,
  listLeadershipThroughRoutine,
  listSquThroughRoutine,
  purgeExpiredThroughRoutine,
  revokeAppointmentThroughRoutine,
  revokeSquThroughRoutine,
  setLeadershipRequestsOpenThroughRoutine,
  setPositionLimitThroughRoutine,
  retentionImpactThroughRoutine,
  setSettingsThroughRoutine,
  settingsThroughRoutine,
  squDocumentThroughRoutine,
} from "./db";
import type {
  CodeResult,
  LeadershipDetail,
  LeadershipListItem,
  LeadershipStatus,
  SquDetail,
  SquListItem,
  SquListState,
  VerificationSettings,
} from "./types";

/**
 * Dashboard access to SQU verification and leadership requests (ADR 0025).
 * Every function takes the actor from the caller's verified session (ADR 0015)
 * and calls one fixed routine, which re-checks the actor's live access itself.
 * Nothing here decides who may review.
 */

export const REVIEW_PAGE_SIZE = 25;

export const SQU_FILTERS = [
  "pending",
  "verified",
  "rejected",
  "revoked",
  "all",
] as const;
export type SquFilter = SquListState | "all";
export const LEADERSHIP_FILTERS = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "all",
] as const;
export type LeadershipFilter = LeadershipStatus | "all";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A calendar day in Muscat time (the society's), as the start of that day, or
 * the start of the next day for an inclusive "to" date.
 */
export function parseDay(value: string | undefined, end = false): Date | null {
  if (!value || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00+04:00`);
  if (Number.isNaN(date.getTime())) return null;
  return end ? new Date(date.getTime() + 86_400_000) : date;
}

export function parseOffset(value: string | undefined): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 && n <= 100_000 ? n : 0;
}

export async function listSquVerifications(
  actor: string,
  filter: {
    state: SquFilter;
    query: string | null;
    from: Date | null;
    to: Date | null;
    offset: number;
  }
): Promise<{ total: number; items: SquListItem[] } | null> {
  const result = await listSquThroughRoutine(actor, filter);
  if (result.code !== "SUCCESS") return null;
  return {
    total: Number(result.total),
    items: result.items as SquListItem[],
  };
}

export async function getSquVerification(
  actor: string,
  request: string
): Promise<SquDetail | { code: "FORBIDDEN" | "NOT_FOUND" }> {
  return (await getSquThroughRoutine(actor, request)) as
    SquDetail | { code: "FORBIDDEN" | "NOT_FOUND" };
}

/**
 * The evidence for a reviewer the routine accepts (null otherwise). A Storage
 * object is fetched here, on the server, and must match the size and SHA-256
 * recorded at submission; any Storage failure throws, so the route answers 503
 * rather than pretending the document does not exist.
 */
export async function readSquDocument(
  actor: string,
  request: string
): Promise<{ mediaType: string; content: Buffer } | null> {
  const row = await squDocumentThroughRoutine(actor, request);
  if (!row) return null;
  if (row.content)
    return { mediaType: row.media_type, content: Buffer.from(row.content) };
  const storage = currentDocumentStorage();
  if (storage.mode !== "storage" || !row.storage_bucket || !row.storage_key)
    throw new Error("Verification document storage is not configured.");
  const object = await getDocumentObject(
    { ...storage.config, bucket: row.storage_bucket },
    row.storage_key,
    MAX_DOCUMENT_BYTES
  );
  if (!object.ok) throw new Error("Verification document is unavailable.");
  const content = Buffer.from(object.bytes);
  if (
    content.byteLength !== Number(row.byte_size) ||
    createHash("sha256").update(content).digest("hex") !== row.sha256
  ) {
    console.error("verification_storage_integrity_failed", { request });
    throw new Error("Verification document failed its integrity check.");
  }
  return { mediaType: row.media_type, content };
}

export const decideSquVerification = (
  actor: string,
  request: string,
  revision: number,
  decision: "approve" | "reject",
  reason: string | null,
  note: string | null
) => decideSquThroughRoutine(actor, request, revision, decision, reason, note);

export const revokeSquVerification = (
  actor: string,
  verification: string,
  reason: string,
  note: string | null
) => revokeSquThroughRoutine(actor, verification, reason, note);

/**
 * The retention cleanup (ADR 0025), run when a reviewer opens the list. It
 * does nothing until Technical sets a retention period; then it removes a
 * small batch of expired evidence and lets the deletion queue remove the
 * Storage objects. Never throws.
 */
export async function purgeExpiredVerificationDocuments(
  actor: string
): Promise<number> {
  try {
    const result = await purgeExpiredThroughRoutine(actor, 25);
    const purged = Number(result.purged ?? 0);
    if (purged > 0) await processMembershipStorageDeletions();
    return purged;
  } catch {
    console.error("verification_retention_failed");
    return 0;
  }
}

export async function listLeadershipRequests(
  actor: string,
  filter: {
    status: LeadershipFilter;
    committee: string | null;
    team: string | null;
    query: string | null;
    from: Date | null;
    to: Date | null;
    offset: number;
  }
): Promise<{ total: number; items: LeadershipListItem[] } | null> {
  const result = await listLeadershipThroughRoutine(actor, filter);
  if (result.code !== "SUCCESS") return null;
  return {
    total: Number(result.total),
    items: result.items as LeadershipListItem[],
  };
}

export type LeadershipFilterCommittee = {
  id: string;
  name: string;
  archived: boolean;
  teams: { id: string; name: string; status: string }[];
};

/** Committees with teams, for the leadership queue's filters. */
export async function leadershipFilterOptions(
  actor: string
): Promise<LeadershipFilterCommittee[]> {
  const result = await leadershipFiltersThroughRoutine(actor);
  return result.code === "SUCCESS"
    ? (result.committees as LeadershipFilterCommittee[])
    : [];
}

export async function getLeadershipRequest(
  actor: string,
  request: string
): Promise<LeadershipDetail | { code: "FORBIDDEN" | "NOT_FOUND" }> {
  return (await getLeadershipThroughRoutine(actor, request)) as
    LeadershipDetail | { code: "FORBIDDEN" | "NOT_FOUND" };
}

export const decideLeadershipRequest = (
  actor: string,
  request: string,
  revision: number,
  decision: "approve" | "reject",
  reason: string | null,
  note: string | null
) =>
  decideLeadershipThroughRoutine(
    actor,
    request,
    revision,
    decision,
    reason,
    note
  );

export const revokeAppointment = (
  actor: string,
  appointment: string,
  revision: number,
  reason: string,
  note: string | null
): Promise<CodeResult> =>
  revokeAppointmentThroughRoutine(actor, appointment, revision, reason, note);

export async function getVerificationSettings(
  actor: string
): Promise<VerificationSettings | null> {
  const result = await settingsThroughRoutine(actor);
  return result.code === "SUCCESS"
    ? (result as unknown as VerificationSettings)
    : null;
}

/**
 * Saves the settings (settings.verification, ADR 0027). Setting or shortening the retention period
 * so stored evidence becomes eligible for deletion is refused with RETENTION_CONFIRMATION_REQUIRED
 * (and the count) until `confirmRetention`; saving itself deletes nothing.
 */
export const setVerificationSettings = (
  actor: string,
  settings: Parameters<typeof setSettingsThroughRoutine>[1],
  confirmRetention = false
) => setSettingsThroughRoutine(actor, settings, confirmRetention);

export const retentionImpact = retentionImpactThroughRoutine;

export const setPositionLimit = (
  actor: string,
  position: string,
  level: "team" | "committee",
  max: number | null
) => setPositionLimitThroughRoutine(actor, position, level, max);

/**
 * Opens or closes new leadership requests (ADR 0026). Holders of settings.verification; the
 * routine re-checks that and audits the change. Existing appointments and pending requests are
 * unaffected.
 */
export const setLeadershipRequestsOpen = (actor: string, open: boolean) =>
  setLeadershipRequestsOpenThroughRoutine(actor, open);
