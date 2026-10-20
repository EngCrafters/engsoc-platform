// Public entry point for UC-01 membership applications (ADR 0017).
//
// The transport (app/v1/membership-applications) hands this module raw form
// values; this module decides whether they are a valid application and passes
// them to the canonical routine, which validates everything again. Nothing a
// caller sends can choose a status, reviewer, role or committee.

export * from "./types";

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { checkDocument } from "./document";
import { statusThroughRoutine, submitThroughRoutine } from "./db";
import {
  CONSENT_VERSIONS,
  MAX_INTERESTS,
  MEMBERSHIP_DISCIPLINES,
  MEMBERSHIP_INTERESTS,
  type ApplicantStatus,
  type ApplicationField,
  type ApplicationStatusResult,
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

export async function submitMembershipApplication(
  input: MembershipApplicationInput,
  ipAddress: string
): Promise<SubmitMembershipResult> {
  if (isIP(ipAddress) === 0) return { ok: false, error: "invalid_ip" };
  const statusToken = createStatusToken();
  const content = Buffer.from(input.document.bytes);
  try {
    const result = await submitThroughRoutine({
      ...input,
      statusTokenHash: hashStatusToken(statusToken),
      mediaType: input.document.mediaType,
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
      ipAddress,
    });
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
