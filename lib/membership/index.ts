// Public entry point for UC-01 membership applications (ADRs 0017 and 0018).
//
// The transport (app/v1/membership-applications) hands this module raw form
// values; this module decides whether they are a valid application and passes
// them to the canonical routine, which validates everything again. Nothing a
// caller sends can choose a status, reviewer, role, committee or storage key.

export * from "./types";

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { logServerError } from "@/lib/api/log";
import { checkDocument } from "./document";
import {
  beginSubmissionThroughRoutine,
  queueAbandonedUploadThroughRoutine,
  ownMembershipThroughRoutine,
  statusThroughRoutine,
  submitStoredThroughRoutine,
  submitThroughRoutine,
} from "./db";
import {
  currentDocumentStorage,
  deleteDocumentObject,
  newDocumentKey,
  putDocumentObject,
  type StorageConfig,
} from "./storage";
import {
  CONSENT_VERSIONS,
  MAX_INTERESTS,
  MEMBERSHIP_DISCIPLINES,
  MEMBERSHIP_INTERESTS,
  type ApplicantStatus,
  type ApplicationField,
  type ApplicationStatus,
  type ApplicationStatusResult,
  type DocumentMediaType,
  type FieldCode,
  type MembershipApplicationInput,
  type MembershipDiscipline,
  type MembershipInterest,
  type SubmitMembershipResult,
} from "./types";

export { checkDocument, sniffDocumentType } from "./document";

const CONTROL = /[\u0000-\u001f\u007f]/;
const SQU_EMAIL = /^[^\s@]+@([a-z0-9-]+\.)*squ\.edu\.om$/;

export type RawApplication = {
  fullName: string | null;
  email: string | null;
  universityId: string | null;
  academicYear: string | null;
  discipline: string | null;
  interests: string[];
  consent: string | null;
  consentVersion: string | null;
  document: Uint8Array | null;
};

export type ValidationResult =
  | { ok: true; value: MembershipApplicationInput }
  | { ok: false; errors: { field: ApplicationField; code: FieldCode }[] };

/**
 * The same rules the routine enforces, reported per field so the website can
 * mark exactly what to correct (UC-01: "show exactly which field").
 */
export function validateApplication(raw: RawApplication): ValidationResult {
  const errors: { field: ApplicationField; code: FieldCode }[] = [];

  const fullName = (raw.fullName ?? "").trim();
  if (!fullName) errors.push({ field: "fullName", code: "required" });
  else if (fullName.length > 200)
    errors.push({ field: "fullName", code: "too-long" });
  else if (CONTROL.test(fullName))
    errors.push({ field: "fullName", code: "invalid" });

  const email = (raw.email ?? "").trim().toLowerCase();
  if (!email) errors.push({ field: "email", code: "required" });
  else if (email.length > 254)
    errors.push({ field: "email", code: "too-long" });
  else if (!SQU_EMAIL.test(email))
    errors.push({ field: "email", code: "invalid" });

  const universityId = (raw.universityId ?? "").trim();
  if (!universityId) errors.push({ field: "universityId", code: "required" });
  else if (!/^[0-9]{6,10}$/.test(universityId))
    errors.push({ field: "universityId", code: "invalid" });

  const year = Number(raw.academicYear);
  if (!raw.academicYear)
    errors.push({ field: "academicYear", code: "required" });
  else if (!/^[1-5]$/.test(raw.academicYear) || !Number.isInteger(year))
    errors.push({ field: "academicYear", code: "invalid" });

  const discipline = raw.discipline ?? "";
  if (!discipline) errors.push({ field: "discipline", code: "required" });
  else if (!(MEMBERSHIP_DISCIPLINES as readonly string[]).includes(discipline))
    errors.push({ field: "discipline", code: "invalid" });

  const interests = raw.interests;
  if (
    interests.length > MAX_INTERESTS ||
    new Set(interests).size !== interests.length ||
    interests.some(
      (value) => !(MEMBERSHIP_INTERESTS as readonly string[]).includes(value)
    )
  )
    errors.push({ field: "interests", code: "invalid" });

  if (raw.consent !== "true")
    errors.push({ field: "consent", code: "required" });
  else if (
    !(CONSENT_VERSIONS as readonly string[]).includes(raw.consentVersion ?? "")
  )
    errors.push({ field: "consent", code: "invalid" });

  const document = checkDocument(raw.document);
  if (!document.ok) errors.push({ field: "idDocument", code: document.code });

  if (errors.length > 0 || !document.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      fullName,
      email,
      universityId,
      academicYear: year,
      discipline: discipline as MembershipDiscipline,
      interests: interests as MembershipInterest[],
      consentVersion: raw.consentVersion!,
      document: { mediaType: document.mediaType, bytes: raw.document! },
    },
  };
}

/** 256 bits, URL-safe. Returned to the applicant once; only its hash is stored. */
export function createStatusToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashStatusToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const STATUS_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isStatusToken = (value: unknown): value is string =>
  typeof value === "string" && STATUS_TOKEN.test(value);

const ROUTINE_FIELDS: Record<string, ApplicationField> = {
  fullName: "fullName",
  email: "email",
  universityId: "universityId",
  academicYear: "academicYear",
  discipline: "discipline",
  interests: "interests",
  consent: "consent",
  idDocument: "idDocument",
};

type RoutineResult = { code: string; field?: string; applicationId?: string };

/** Queues an object nothing may reference; the routine refuses a referenced one. */
async function queueAbandonedUpload(bucket: string, key: string) {
  try {
    await queueAbandonedUploadThroughRoutine(bucket, key);
  } catch {
    // The key is random and identifies no one; it is what cleanup needs.
    console.error("membership_storage_orphan", { bucket, key });
  }
}

/**
 * The Storage path (ADR 0018): the database records the attempt and refuses
 * known duplicates before anything is uploaded, Core stores the object under
 * a random key, and only then does the database write the application with
 * the reference. An object whose application is not written is deleted, or
 * queued for deletion when that cannot be done (or confirmed) at once.
 */
async function submitWithStorage(
  config: StorageConfig,
  application: Parameters<typeof submitThroughRoutine>[0] & {
    mediaType: DocumentMediaType;
  }
): Promise<RoutineResult> {
  const begun = await beginSubmissionThroughRoutine(application);
  if (begun.code !== "SUCCESS") return begun;

  const key = newDocumentKey(application.mediaType);
  const stored = await putDocumentObject(
    config,
    key,
    application.content,
    application.mediaType,
    application.sha256
  );
  if (!stored.ok) {
    if (stored.uncertain) await queueAbandonedUpload(config.bucket, key);
    return { code: "STORAGE_UNAVAILABLE" };
  }

  let result: RoutineResult;
  try {
    result = await submitStoredThroughRoutine({
      ...application,
      byteSize: application.content.byteLength,
      storageBucket: config.bucket,
      storageKey: key,
    });
  } catch (error) {
    // The write may or may not have committed: only the queue, which checks
    // for a reference, may remove the object now.
    await queueAbandonedUpload(config.bucket, key);
    throw error;
  }
  if (result.code !== "SUCCESS") {
    // A refusal returns before anything is written, so nothing references it.
    if (!(await deleteDocumentObject(config, key))) {
      await queueAbandonedUpload(config.bucket, key);
    }
  }
  return result;
}

export async function submitMembershipApplication(
  input: MembershipApplicationInput,
  ipAddress: string
): Promise<SubmitMembershipResult> {
  if (isIP(ipAddress) === 0) return { ok: false, error: "invalid_ip" };
  const storage = currentDocumentStorage();
  // Half-configured Storage is a deployment error: never fall back silently.
  if (storage.mode === "misconfigured") {
    return { ok: false, error: "server_error" };
  }
  const statusToken = createStatusToken();
  const content = Buffer.from(input.document.bytes);
  const application = {
    ...input,
    statusTokenHash: hashStatusToken(statusToken),
    mediaType: input.document.mediaType,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
    ipAddress,
  };
  try {
    const result =
      storage.mode === "storage"
        ? await submitWithStorage(storage.config, application)
        : await submitThroughRoutine(application);
    switch (result.code) {
      case "SUCCESS":
        return {
          ok: true,
          applicationId: result.applicationId!,
          statusToken,
        };
      case "VALIDATION_ERROR":
        return {
          ok: false,
          error: "invalid_field",
          field: ROUTINE_FIELDS[result.field ?? ""],
        };
      case "ALREADY_APPLIED":
        return { ok: false, error: "already_applied" };
      case "ALREADY_MEMBER":
        return { ok: false, error: "already_member" };
      case "RATE_LIMITED":
        return { ok: false, error: "rate_limited" };
      case "INVALID_IP":
        return { ok: false, error: "invalid_ip" };
      default:
        return { ok: false, error: "server_error" };
    }
  } catch {
    return { ok: false, error: "server_error" };
  }
}

export async function getApplicationStatus(
  statusToken: string
): Promise<ApplicationStatusResult> {
  if (!isStatusToken(statusToken)) return { ok: false, error: "not_found" };
  try {
    const result = await statusThroughRoutine(hashStatusToken(statusToken));
    if (result.code === "NOT_FOUND") return { ok: false, error: "not_found" };
    if (result.code !== "SUCCESS") return { ok: false, error: "server_error" };
    return {
      ok: true,
      status: result.status as ApplicantStatus,
      submittedAt: new Date(result.submittedAt!).toISOString(),
      decidedAt: result.decidedAt
        ? new Date(result.decidedAt).toISOString()
        : null,
      activated: result.activated === true,
    };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

export type OwnMembership =
  | { ok: true; emailConfirmed: false }
  | {
      ok: true;
      emailConfirmed: true;
      member: { status: "member" | "graduate"; since: string } | null;
      application: {
        status: ApplicationStatus;
        submittedAt: string;
        decidedAt: string | null;
        activated: boolean;
      } | null;
    }
  | { ok: false };

const iso = (value: string) => new Date(value).toISOString();

/**
 * The signed-in person's own membership and latest application (ADR 0019).
 * `userId` must be the identity Supabase Auth verified for this request. The
 * database links an application only to a confirmed email and completes an
 * activation reviewers already approved; it never approves anything itself.
 */
export async function getOwnMembership(userId: string): Promise<OwnMembership> {
  try {
    const result = await ownMembershipThroughRoutine(userId);
    if (result.code === "EMAIL_UNCONFIRMED") {
      return { ok: true, emailConfirmed: false };
    }
    if (result.code !== "SUCCESS") return { ok: false };
    const app = result.application;
    return {
      ok: true,
      emailConfirmed: true,
      member: result.member
        ? {
            status: result.member.status as "member" | "graduate",
            since: iso(result.member.since),
          }
        : null,
      application: app
        ? {
            status: app.status as ApplicationStatus,
            submittedAt: iso(app.submittedAt),
            decidedAt: app.decidedAt ? iso(app.decidedAt) : null,
            activated: app.activated === true,
          }
        : null,
    };
  } catch (error) {
    // Without 0027 the routine is missing: logged as a schema mismatch.
    logServerError("own_membership_failed", error);
    return { ok: false };
  }
}
