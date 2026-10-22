/** Shared public access-domain messages; no provider or database error details. */
export const ACCESS_ERROR_MESSAGES: Record<string, string> = {
  SUCCESS: "Access updated.",
  REASSIGN_REQUIRED:
    "This user already manages another committee. Reassign their committee instead.",
  SECOND_MANAGER_SCOPE:
    "This user already manages another committee. Reassign their committee instead.",
  ACCESS_ALREADY_REVOKED: "This account no longer has administrative access.",
  ACCESS_CHANGED:
    "Access has changed. Refresh the user list before trying again.",
  FORBIDDEN:
    "Your access level does not allow this change. Board Administration manages Committee Managers; the Technical Team manages every role.",
  COMMITTEE_ARCHIVED:
    "This committee is archived. Restore it before assigning managers.",
  SELF_CHANGE: "You cannot change your own access.",
  NOT_SUSPENDED:
    "This access was revoked, not suspended. Assign a role again instead.",
  ALREADY_INACTIVE: "This access is already inactive.",
  CONFLICT:
    "This user already has a different active access level. Revoke it before granting a new level.",
  ALREADY_ACTIVE: "This access is already active.",
  NOT_FOUND: "No active access assignment was found.",
  USER_NOT_FOUND: "The selected account no longer exists.",
  COMMITTEE_NOT_FOUND: "Select a valid committee.",
  INVALID_TRANSITION: "This reassignment is not valid.",
  LAST_TECHNICAL_ADMIN:
    "At least one active Technical Team administrator must remain. Grant Technical access to another user before removing this account.",
  SELF_ESCALATION: "You cannot elevate your own account through this action.",
};
