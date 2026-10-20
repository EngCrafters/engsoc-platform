// Shared types and fixed vocabularies for UC-01 membership applications
// (ADR 0017, docs/UC-01_Membership_Applications.md). The database routines
// enforce the same lists; tests/db/membership.test.ts proves they agree.

/** The website's seven disciplines (its `content/disciplines.ts` ids). */
export const MEMBERSHIP_DISCIPLINES = [
  "mechanical",
  "electrical",
  "civil",
  "petroleum",
  "chemical",
  "mechatronics",
  "industrial",
] as const;
export type MembershipDiscipline = (typeof MEMBERSHIP_DISCIPLINES)[number];

/** The website's interest options (its `SKILLS` ids). Optional; at most four. */
export const MEMBERSHIP_INTERESTS = [
  "cad",
  "simulation",
  "embedded",
  "robotics",
  "structures",
  "process",
  "data",
  "programming",
  "power",
  "reservoir",
  "quality",
  "management",
  "sustainability",
  "hse",
] as const;
export type MembershipInterest = (typeof MEMBERSHIP_INTERESTS)[number];
export const MAX_INTERESTS = 4;

/** Consent wordings Core accepts. The text of each is in the data contract. */
export const CONSENT_VERSIONS = ["2026-10-v1"] as const;

/** 4 MiB: inside Vercel's 4.5 MB request limit with room for the other fields. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export const DOCUMENT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type DocumentMediaType = (typeof DOCUMENT_MEDIA_TYPES)[number];

export const APPLICATION_STATUSES = [
  "pending_review",
  "verified",
  "approved",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** What an applicant may see: verification is an internal stage. */
export type ApplicantStatus = "pending_review" | "approved" | "rejected";

export type ApplicationField =
  | "fullName"
  | "email"
  | "universityId"
  | "academicYear"
  | "discipline"
  | "interests"
  | "consent"
  | "idDocument";

/** A field problem the public API reports in `errors[]`. */
export type FieldCode =
  "required" | "invalid" | "too-long" | "too-large" | "unsupported-type";

export type MembershipApplicationInput = {
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  discipline: MembershipDiscipline;
  interests: MembershipInterest[];
  consentVersion: string;
  document: { mediaType: DocumentMediaType; bytes: Uint8Array };
};

export type SubmitMembershipResult =
  | { ok: true; applicationId: string; statusToken: string }
  | {
      ok: false;
      error:
        | "invalid_field"
        | "already_applied"
        | "already_member"
        | "rate_limited"
        | "invalid_ip"
        | "server_error";
      field?: ApplicationField;
    };

export type ApplicationStatusResult =
  | {
      ok: true;
      status: ApplicantStatus;
      submittedAt: string;
      decidedAt: string | null;
      activated: boolean;
    }
  | { ok: false; error: "not_found" | "server_error" };

export type ReviewerKind = "senior" | "society_affairs";
export type ApprovalPolicy = "two_step" | "single_step";
export type ReviewDecision = "verify" | "approve" | "reject";
