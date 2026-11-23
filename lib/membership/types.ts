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

/**
 * Consent wordings Core accepts. The text of each is in the data contract. 2026-11-v2 is the
 * current form (ADR 0025, no ID card); 2026-10-v1 is the previous website's, accepted during a
 * release.
 */
export const CONSENT_VERSIONS = ["2026-10-v1", "2026-11-v2"] as const;
export const CURRENT_CONSENT_VERSION = "2026-11-v2";

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
  | "category"
  | "institution"
  | "institutionName"
  | "academicYear"
  | "discipline"
  | "interests"
  | "consent";

/** A field problem the public API reports in `errors[]`. */
export type FieldCode =
  "required" | "invalid" | "too-long" | "too-large" | "unsupported-type";

/**
 * A validated application (ADR 0025). Details a category does not collect are already dropped:
 * `institutionId` and `institutionName` are never both set, and `academicYear` is set only for a
 * category that asks for it.
 */
export type MembershipApplicationInput = {
  fullName: string;
  email: string;
  category: string;
  institutionId: string | null;
  institutionName: string | null;
  academicYear: number | null;
  discipline: MembershipDiscipline;
  interests: MembershipInterest[];
  consentVersion: string;
};

/** The registration form's choices, read from the database (`private.get_membership_options`). */
export type LocalizedText = { en: string; ar: string };
export type MembershipCategoryOption = {
  id: string;
  label: LocalizedText;
  institution: "required" | "optional" | "none";
  academicYear: boolean;
};
export type InstitutionOption = {
  id: string;
  name: LocalizedText;
  country: string;
};
export type MembershipOptions = {
  categories: MembershipCategoryOption[];
  institutions: InstitutionOption[];
  consentVersion: string;
  /**
   * Whether a valid registration is approved at once ('automatic', ADR 0029) or waits for a
   * reviewer ('review'). For the form's wording only; the database decides at submission.
   */
  approval: "automatic" | "review";
  /** How a registrant's account is created (ADR 0030); the submission decides, this is wording. */
  accountActivation: AccountActivation;
};

/**
 * ADR 0030: 'email_confirmation' (Supabase sign-up, confirmation email) or 'immediate' (Core
 * creates the account without email verification and signs the registering browser in once).
 */
export type AccountActivation = "email_confirmation" | "immediate";
export const ACCOUNT_ACTIVATIONS: readonly AccountActivation[] = [
  "email_confirmation",
  "immediate",
];

/** The wire value for "my university is not listed"; the name then comes from `institutionName`. */
export const OTHER_INSTITUTION = "other";

export type SubmitMembershipResult =
  | {
      ok: true;
      applicationId: string;
      statusToken: string;
      /** 'approved' when the automatic policy approved it at submission (ADR 0029). */
      status: "pending_review" | "approved";
      /** The account activation mode recorded with the application (ADR 0030). */
      accountActivation: AccountActivation;
    }
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

/**
 * How the database describes a membership reviewer (ADR 0027): 'senior' can also give final
 * approval, 'reviewer' cannot. 'society_affairs' appears only in audit entries written before 0035.
 */
export type ReviewerKind = "senior" | "reviewer" | "society_affairs";
export type ApprovalPolicy = "two_step" | "single_step" | "automatic";
export type ReviewDecision = "verify" | "approve" | "reject";
