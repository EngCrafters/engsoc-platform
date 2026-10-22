/** One safe sentence per routine result (ADR 0024). Never SQL, stack or identifiers. */
export const ADMINISTRATION_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Your access level does not allow this.",
  VALIDATION_ERROR: "Check the details and try again.",
  NOT_FOUND: "This record no longer exists. Refresh the page.",
  NAME_TAKEN: "Another committee already uses this name.",
  SLUG_TAKEN: "Another committee already uses this identifier.",
  UNCHANGED: "Nothing changed.",
  ALREADY_ARCHIVED: "This committee is already archived.",
  NOT_ARCHIVED: "This committee is already active.",
  PROTECTED_COMMITTEE:
    "Society Affairs and the Technical Team run membership, project and system workflows, so they cannot be archived.",
  COMMITTEE_ARCHIVED:
    "This committee is archived. Restore it before adding managers or members.",
  MEMBER_NOT_FOUND: "That member no longer exists.",
  ALREADY_ADDED: "This member is already on the committee.",
  SELF_CHANGE: "You cannot change or delete your own access or records.",
  ALREADY_INACTIVE: "This access is already inactive.",
  ALREADY_ACTIVE: "This access is already active.",
  NOT_SUSPENDED:
    "This access was revoked, not suspended. Grant a role again instead.",
  LAST_TECHNICAL_ADMIN:
    "The last active Technical Team account cannot lose access.",
  CONFIRMATION_MISMATCH:
    "The confirmation text does not match. Type it exactly as shown.",
  STORAGE_UNAVAILABLE:
    "File storage is not configured on this server, so the files could not be scheduled for deletion. Nothing was deleted.",
  PASSWORD_INVALID: "Your password is not correct.",
  PASSWORD_UNAVAILABLE:
    "Your password could not be checked right now. Nothing was deleted; try again shortly.",
  UNAVAILABLE: "The operation is temporarily unavailable. Try again.",
};

export const BLOCKER_MESSAGES: Record<string, string> = {
  EVENT_ACTIVE:
    "The event is live. Archive it first, so it leaves the public site, then delete it.",
  EVENT_HAS_REGISTRATIONS:
    "This draft has registrations. Archive it before deleting it.",
  CERTIFICATES_EXIST:
    "Certificates were issued for this event. Certificates are permanent records, so the event is kept.",
  PROJECT_PUBLISHED:
    "The project is public. Unpublish it first, then delete it.",
  MEMBER_HAS_PROJECTS:
    "The member authored projects. Delete or keep those projects deliberately first; they are never removed implicitly.",
  LEGACY_RECORDS: "Archive or mentorship records still reference this member.",
  ACTIVE_ACCESS: "The account still has dashboard access. Revoke it first.",
  ACCOUNTABILITY_RECORDS:
    "This account made decisions about other people (grants, reviews, approvals or policy). Its identity is kept for accountability.",
};

export function administrationMessage(code: string, fallback?: string) {
  return (
    ADMINISTRATION_MESSAGES[code] ??
    fallback ??
    ADMINISTRATION_MESSAGES.UNAVAILABLE
  );
}
