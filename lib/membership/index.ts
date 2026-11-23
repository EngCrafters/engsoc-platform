// Public entry point for UC-01 membership applications (ADRs 0017 and 0025).
//
// The transport (app/v1/membership-applications) hands this module raw form
// values; this module decides whether they are a valid application and passes
// them to the canonical routine, which validates everything again. Nothing a
// caller sends can choose a status, reviewer, role, committee or storage key.
// Registration carries no document (ADR 0025): SQU student verification is a
// separate, signed-in flow (lib/verification).

export * from "./types";

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { logServerError } from "@/lib/api/log";
import {
  createImmediateAccount,
  createSignInTokenHash,
} from "@/lib/auth/admin";
import {
  beginImmediateAccountThroughRoutine,
  completeImmediateAccountThroughRoutine,
  optionsThroughRoutine,
  ownMembershipThroughRoutine,
  statusThroughRoutine,
  submitThroughRoutine,
} from "./db";
import {
  CONSENT_VERSIONS,
  MAX_INTERESTS,
  MEMBERSHIP_DISCIPLINES,
  MEMBERSHIP_INTERESTS,
  OTHER_INSTITUTION,
  type AccountActivation,
  type ApplicantStatus,
  type ApplicationField,
  type ApplicationStatus,
  type ApplicationStatusResult,
  type FieldCode,
  type MembershipApplicationInput,
  type MembershipDiscipline,
  type MembershipInterest,
  type MembershipOptions,
  type SubmitMembershipResult,
} from "./types";

export { checkDocument, sniffDocumentType } from "./document";

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Any address with a local part, a domain and a dot in it: personal or institutional. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RawApplication = {
  fullName: string | null;
  email: string | null;
  category: string | null;
  institution: string | null;
  institutionName: string | null;
  academicYear: string | null;
  discipline: string | null;
  interests: string[];
  consent: string | null;
  consentVersion: string | null;
};

export type ValidationResult =
  | { ok: true; value: MembershipApplicationInput }
  | { ok: false; errors: { field: ApplicationField; code: FieldCode }[] };

/**
 * The same rules the routine enforces, reported per field so the website can
 * mark exactly what to correct (UC-01: "show exactly which field"). The
 * category decides which details apply (ADR 0025); a detail it does not
 * collect is dropped here, so a value typed before the applicant switched
 * category is never stored and never blocks the application.
 */
export function validateApplication(
  raw: RawApplication,
  options: Pick<MembershipOptions, "categories" | "institutions">
): ValidationResult {
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
  else if (!EMAIL.test(email)) errors.push({ field: "email", code: "invalid" });

  const categoryId = (raw.category ?? "").trim();
  const category = options.categories.find((c) => c.id === categoryId);
  if (!categoryId) errors.push({ field: "category", code: "required" });
  else if (!category) errors.push({ field: "category", code: "invalid" });

  let institutionId: string | null = null;
  let institutionName: string | null = null;
  if (category && category.institution !== "none") {
    const chosen = (raw.institution ?? "").trim();
    if (chosen === OTHER_INSTITUTION) {
      const name = (raw.institutionName ?? "").trim();
      if (!name) errors.push({ field: "institutionName", code: "required" });
      else if (name.length > 120)
        errors.push({ field: "institutionName", code: "too-long" });
      else if (name.length < 2 || CONTROL.test(name))
        errors.push({ field: "institutionName", code: "invalid" });
      else institutionName = name;
    } else if (chosen) {
      if (options.institutions.some((i) => i.id === chosen))
        institutionId = chosen;
      else errors.push({ field: "institution", code: "invalid" });
    } else if (category.institution === "required") {
      errors.push({ field: "institution", code: "required" });
    }
  }

  let academicYear: number | null = null;
  if (category?.academicYear) {
    if (!raw.academicYear)
      errors.push({ field: "academicYear", code: "required" });
    else if (!/^[1-5]$/.test(raw.academicYear))
      errors.push({ field: "academicYear", code: "invalid" });
    else academicYear = Number(raw.academicYear);
  }

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

  if (errors.length > 0 || !category) return { ok: false, errors };
  return {
    ok: true,
    value: {
      fullName,
      email,
      category: category.id,
      institutionId,
      institutionName,
      academicYear,
      discipline: discipline as MembershipDiscipline,
      interests: interests as MembershipInterest[],
      consentVersion: raw.consentVersion!,
    },
  };
}

const OPTIONS_TTL_MS = 5 * 60_000;
let cachedOptions: { value: MembershipOptions; at: number } | null = null;

/**
 * The categories and institutions the database currently offers. Read
 * through a short per-process cache: they change only by migration, and the
 * routine re-validates every submission anyway.
 */
export async function membershipOptions(): Promise<MembershipOptions> {
  if (cachedOptions && Date.now() - cachedOptions.at < OPTIONS_TTL_MS)
    return cachedOptions.value;
  const result = await optionsThroughRoutine();
  if (result.code !== "SUCCESS")
    throw new Error("Membership options unavailable");
  const value: MembershipOptions = {
    categories: result.categories ?? [],
    institutions: result.institutions ?? [],
    consentVersion: result.consentVersion ?? "",
    approval: result.approval === "automatic" ? "automatic" : "review",
    accountActivation: accountActivationOf(result.accountActivation),
  };
  cachedOptions = { value, at: Date.now() };
  return value;
}

/** Anything but the database's explicit 'immediate' is the email confirmation default. */
const accountActivationOf = (value: unknown): AccountActivation =>
  value === "immediate" ? "immediate" : "email_confirmation";

/** For tests: forget the cached options. */
export function resetMembershipOptionsCache() {
  cachedOptions = null;
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
  category: "category",
  institution: "institution",
  institutionName: "institutionName",
  academicYear: "academicYear",
  discipline: "discipline",
  interests: "interests",
  consent: "consent",
};

export async function submitMembershipApplication(
  input: MembershipApplicationInput,
  ipAddress: string
): Promise<SubmitMembershipResult> {
  if (isIP(ipAddress) === 0) return { ok: false, error: "invalid_ip" };
  const statusToken = createStatusToken();
  try {
    const result = await submitThroughRoutine({
      ...input,
      statusTokenHash: hashStatusToken(statusToken),
      ipAddress,
    });
    switch (result.code) {
      case "SUCCESS":
        return {
          ok: true,
          applicationId: result.applicationId!,
          statusToken,
          // A database before 0037 does not say; its applications always wait for review.
          status: result.status === "approved" ? "approved" : "pending_review",
          // Before 0038, accounts always need email confirmation.
          accountActivation: accountActivationOf(result.accountActivation),
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

export type ImmediateAccountResult =
  | { ok: true; tokenHash: string; member: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "confirmation_required"
        | "expired"
        | "account_exists"
        | "already_set_up"
        | "not_configured"
        | "server_error";
    };

const IMMEDIATE_REFUSALS: Record<
  string,
  Extract<ImmediateAccountResult, { ok: false }>["error"]
> = {
  NOT_FOUND: "not_found",
  NOT_IMMEDIATE: "confirmation_required",
  NOT_AVAILABLE: "not_found",
  EXPIRED: "expired",
  ACCOUNT_EXISTS: "account_exists",
  ALREADY_SET_UP: "already_set_up",
};

/**
 * Immediate account activation (ADR 0030). The status token proves only that the caller is the
 * browser that submitted the application; the database decides everything else and supplies the
 * email. Core creates the account it reserved (confirmed by the Admin API, no password, no email),
 * links it and, if approved, writes the member record, then returns one magic-link token hash for
 * the browser to sign in with and set its own password. The password never reaches Core.
 */
export async function setUpImmediateAccount(
  statusToken: string
): Promise<ImmediateAccountResult> {
  if (!isStatusToken(statusToken)) return { ok: false, error: "not_found" };
  const tokenHash = hashStatusToken(statusToken);
  try {
    let begin = await beginImmediateAccountThroughRoutine(tokenHash);
    if (begin.code === "CREATE") {
      const created = await createImmediateAccount({
        id: begin.userId!,
        email: begin.email!,
        applicationId: begin.applicationId!,
      });
      if (created.code === "EMAIL_EXISTS") {
        // Created by an earlier attempt, or by someone else meanwhile: the database tells which.
        begin = await beginImmediateAccountThroughRoutine(tokenHash);
      } else if (created.code !== "SUCCESS") {
        return {
          ok: false,
          error:
            created.code === "UNAVAILABLE" ? "not_configured" : "server_error",
        };
      } else {
        begin = { ...begin, code: "LINK" };
      }
    }
    if (begin.code !== "LINK") {
      return {
        ok: false,
        error: IMMEDIATE_REFUSALS[begin.code] ?? "server_error",
      };
    }
    const completed = await completeImmediateAccountThroughRoutine(
      tokenHash,
      begin.userId!
    );
    if (completed.code !== "SUCCESS") {
      return {
        ok: false,
        error: IMMEDIATE_REFUSALS[completed.code] ?? "server_error",
      };
    }
    const link = await createSignInTokenHash(begin.email!);
    if (link.code !== "SUCCESS" || !link.tokenHash) {
      return { ok: false, error: "server_error" };
    }
    return {
      ok: true,
      tokenHash: link.tokenHash,
      member: completed.member === true,
    };
  } catch (error) {
    logServerError("membership_immediate_account_failed", error);
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
