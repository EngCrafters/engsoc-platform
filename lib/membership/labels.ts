import type {
  AccountActivation,
  ApplicationStatus,
  ApprovalPolicy,
  MembershipDiscipline,
  MembershipInterest,
  ReviewerKind,
} from "./types";

/** Dashboard wording (English, like the rest of the dashboard). */

export const DISCIPLINE_LABELS: Record<MembershipDiscipline, string> = {
  mechanical: "Mechanical Engineering",
  electrical: "Electrical & Computer Engineering",
  civil: "Civil & Architectural Engineering",
  petroleum: "Petroleum Engineering",
  chemical: "Chemical Engineering",
  mechatronics: "Mechatronics Engineering",
  industrial: "Industrial Engineering",
};

export const INTEREST_LABELS: Record<MembershipInterest, string> = {
  cad: "CAD & 3D modelling",
  simulation: "Simulation & FEA",
  embedded: "Embedded systems",
  robotics: "Robotics & control",
  structures: "Structural analysis",
  process: "Process design",
  data: "Data analysis",
  programming: "Programming",
  power: "Power systems",
  reservoir: "Reservoir engineering",
  quality: "Quality & lean",
  management: "Project management",
  sustainability: "Sustainability",
  hse: "Health & safety",
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending_review: "Pending review",
  verified: "Verified",
  approved: "Approved",
  rejected: "Rejected",
};

export const REVIEWER_LABELS: Record<ReviewerKind, string> = {
  senior: "a reviewer who can give final approval",
  reviewer: "a reviewer",
  society_affairs: "Society Affairs",
};

export const POLICY_LABELS: Record<ApprovalPolicy, string> = {
  two_step:
    "Two steps: Society Affairs or Senior Management verifies, then a different Senior Management reviewer approves.",
  single_step:
    "One step: any Society Affairs or Senior Management reviewer may approve.",
  automatic:
    "Automatic: every valid registration is approved at once. The member account becomes active when the applicant confirms their email.",
};

/** ADR 0030: how registrants' accounts are created. */
export const ACCOUNT_ACTIVATION_LABELS: Record<
  AccountActivation,
  { title: string; description: string }
> = {
  email_confirmation: {
    title: "Email confirmation required",
    description:
      "Registrants get a confirmation link by email. Their account, and their membership, become active once they confirm it. This proves they own the address.",
  },
  immediate: {
    title: "Immediate activation",
    description:
      "No confirmation email. The account is created at registration and the registrant is signed in straight away. The email address is not verified.",
  },
};

export const disciplineLabel = (value: string) =>
  DISCIPLINE_LABELS[value as MembershipDiscipline] ?? value;
export const interestLabel = (value: string) =>
  INTEREST_LABELS[value as MembershipInterest] ?? value;

export const MEMBERSHIP_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED:
    "Your administrator session has expired. Sign in again to continue.",
  FORBIDDEN:
    "Membership applications are reviewed by Society Affairs and Senior Management only.",
  NOT_FOUND: "This application is no longer available. Refresh the list.",
  VALIDATION_ERROR: "Check the note (500 characters at most) and try again.",
  STALE_REVISION:
    "This application changed in another session. The latest version is shown; review it again.",
  SELF_REVIEW: "You cannot review your own membership application.",
  INVALID_TRANSITION:
    "This action is not available in the application's current state. Refresh the page.",
  POLICY_NOT_CONFIRMED:
    "Final approval is disabled until the owner's approval policy is recorded by the Technical Team.",
  VERIFICATION_REQUIRED:
    "Under the two-step policy, the application must be verified before final approval.",
  SENIOR_APPROVAL_REQUIRED:
    "Under the two-step policy, final approval is given by Senior Management.",
  SECOND_REVIEWER_REQUIRED:
    "A different Senior Management reviewer must give final approval after your verification.",
  CONFLICT:
    "Another member record already uses this email or student ID. Resolve it with the Technical Team before activating.",
  EMAIL_UNCONFIRMED:
    "Approved. The applicant has not confirmed their email yet, so no account can be linked. Their membership activates when they confirm and sign in; you can also retry activation later.",
  INVITE_RATE_LIMITED:
    "The invitation email limit has been reached. The application stays approved; try activation again later.",
  INVITE_UNAVAILABLE:
    "The invitation email could not be sent. The application stays approved; try activation again.",
  SERVER_ERROR:
    "We couldn't complete this action because of an unexpected server error. Try again; if it continues, contact the Technical Team.",
};

export const membershipMessage = (code: string | undefined) =>
  (code && MEMBERSHIP_MESSAGES[code]) || MEMBERSHIP_MESSAGES.SERVER_ERROR;
