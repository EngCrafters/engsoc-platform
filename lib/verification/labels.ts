// Dashboard wording for SQU verification, leadership and teams (ADR 0025).
// The dashboard is English-only, like the rest of /admin.

import type { LeadershipStatus, SquListState, TeamSummary } from "./types";

/**
 * Who reviews SQU verification and decides leadership (migration 0033's
 * private.verification_reviewer_kind). "senior" here is Board Administration
 * only: Technical access alone grants no review authority.
 */
/** 'reviewer' since 0035 (ADR 0027); the older kinds remain in history written before it. */
export const VERIFICATION_REVIEWER_LABELS: Record<
  "senior" | "reviewer" | "society_affairs",
  string
> = {
  reviewer: "a reviewer",
  senior: "Board Administration",
  society_affairs: "Society Affairs",
};

export const VERIFICATION_REVIEWERS_SENTENCE =
  "Reviewed and decided by people with the review permission, initially Board Administration and Society Affairs. Their committee or team permissions decide who else may.";

export const SQU_STATE_LABELS: Record<SquListState, string> = {
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
  revoked: "Revoked",
};

export const LEADERSHIP_STATUS_LABELS: Record<LeadershipStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Closed",
};

export const TEAM_STATUS_LABELS: Record<TeamSummary["status"], string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const CANCELLATION_LABELS: Record<string, string> = {
  team_moved: "Closed: the team moved to another committee",
  team_inactive: "Closed: the team was deactivated",
  team_archived: "Closed: the team was archived",
  committee_archived: "Closed: the committee was archived",
};

export const VERIFICATION_HISTORY_LABELS: Record<string, string> = {
  "verification.submitted": "Evidence submitted",
  "verification.document_viewed": "Evidence viewed",
  "verification.approved": "Verified",
  "verification.rejected": "Rejected",
  "verification.revoked": "Verification revoked",
  "leadership.requested": "Requested",
  "leadership.approved": "Approved",
  "leadership.rejected": "Rejected",
  "leadership.cancelled": "Closed by a structure change",
  "appointment.created": "Appointed directly",
  "appointment.updated": "Position changed",
  "appointment.revoked": "Appointment revoked",
  "leadership.requests_opened": "Leadership requests opened",
  "leadership.requests_closed": "Leadership requests closed",
  "permissions.changed": "Permissions changed",
};

/** Plain wording for every result code the review and team routines return. */
export const VERIFICATION_MESSAGES: Record<string, string> = {
  SUCCESS: "Saved.",
  FORBIDDEN: "You no longer have permission to do this.",
  NOT_FOUND: "This record no longer exists.",
  STALE_REVISION:
    "Someone else changed this record. Reload the page to see the latest version.",
  INVALID_TRANSITION: "This record has already been decided.",
  SELF_REVIEW: "You can't decide or change your own record.",
  VALIDATION_ERROR: "Check the highlighted fields and try again.",
  STUDENT_NUMBER_IN_USE:
    "This student number is already verified for another member. Reject the request or revoke the other verification first.",
  ALREADY_VERIFIED: "This member already has an active SQU verification.",
  STALE_STRUCTURE:
    "The team, committee or position changed since the request was made. Reject the request so the member can request again.",
  POSITION_FULL:
    "This position is already filled at this level (the committee or this team). Revoke or change the current holder first.",
  MEMBER_LIMIT_REACHED:
    "This member already holds the maximum number of appointments.",
  ALREADY_APPOINTED:
    "This member already holds a position at this level (the committee or this team).",
  PENDING_REQUEST:
    "This member has a pending request for this position's committee or team. Decide it in Membership → Leadership first.",
  HIERARCHY_MISMATCH: "That team belongs to another committee.",
  REQUESTS_CLOSED: "Leadership requests are closed.",
  MEMBER_NOT_FOUND: "That member no longer exists.",
  TEAM_INACTIVE: "Activate the team first.",
  TEAM_ARCHIVED: "Archived teams can't be changed. Restore it first.",
  COMMITTEE_ARCHIVED: "The committee is archived.",
  COMMITTEE_NOT_FOUND: "Choose an active committee.",
  NAME_TAKEN: "Another team in this committee already has that name.",
  UNCHANGED: "Nothing changed.",
  BLOCKED: "End the team's active appointments first.",
  IN_USE:
    "This team has requests or appointments, so it is kept for history. Archive it instead.",
  STORAGE_UNAVAILABLE: "The document store is unavailable. Try again shortly.",
  RETENTION_CONFIRMATION_REQUIRED:
    "Confirm the retention change: stored evidence older than this period will become eligible for deletion.",
  LAST_RECOVERY_ACCOUNT:
    "This would leave no account able to manage permissions and administrator access. Give that access to someone else first.",
  SERVER_ERROR: "Something went wrong. Try again.",
};

export const verificationMessage = (code: string) =>
  VERIFICATION_MESSAGES[code] ?? VERIFICATION_MESSAGES.SERVER_ERROR;

export const teamName = (name: { en: string; ar: string | null }) =>
  name.ar ? `${name.en} · ${name.ar}` : name.en;

/**
 * A leadership path in reading order (ADR 0026): "Committee → Position" for
 * committee-level leadership, "Committee → Team → Position" for team
 * leadership.
 */
export const leadershipPath = (
  committee: string,
  team: { name: { en: string } } | null,
  position: { label: { en: string } }
) =>
  team
    ? `${committee} → ${team.name.en} → ${position.label.en}`
    : `${committee} → ${position.label.en}`;
