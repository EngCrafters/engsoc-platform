import {
  AUTH_EMAIL_PROBLEM_MESSAGES,
  PASSWORD_UPDATE_FAILED_MESSAGE,
} from "@/lib/auth/callback";

export type UserActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export const initialUserActionState: UserActionState = { status: "idle" };

/** One safe sentence per expected failure. No SQL, stack, token or secret. */
export const USER_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "This action is available only to the Technical Team.",
  USER_NOT_FOUND: "The selected account no longer exists.",
  EMAIL_EXISTS: "An account already exists with this email address.",
  SECOND_MANAGER_SCOPE:
    "This user already manages another committee. Reassign their committee instead.",
  LAST_TECHNICAL_ADMIN:
    "At least one active Technical Team administrator must remain. Grant Technical access to another user before removing this account.",
  PASSWORD_UPDATE_FAILED: PASSWORD_UPDATE_FAILED_MESSAGE,
  WEAK_PASSWORD:
    "That password is too easy to guess. Choose a longer, less common one.",
  EMAIL_RATE_LIMIT: AUTH_EMAIL_PROBLEM_MESSAGES.EMAIL_RATE_LIMIT,
  SMTP_UNAVAILABLE: AUTH_EMAIL_PROBLEM_MESSAGES.SMTP_UNAVAILABLE,
  INVALID_INPUT: "Check the details and try again.",
  UNAVAILABLE: "User administration is temporarily unavailable. Try again.",
  SELF_ESCALATION: "You cannot elevate your own account through this action.",
  SELF_TARGET: "Use your own account page to change your own password.",
  NOT_PENDING: "This account has already accepted its invitation.",
};
