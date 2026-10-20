import { safeAdminReturnPath } from "@/lib/auth/paths";

/** Email OTP types the callback accepts. Anything else is rejected. */
const OTP_TYPES = [
  "recovery",
  "invite",
  "signup",
  "email_change",
  "magiclink",
  "email",
] as const;
export type CallbackOtpType = (typeof OTP_TYPES)[number];

/** Short-lived marker set when a recovery email is requested (see actions.ts). */
export const RECOVERY_INTENT_COOKIE = "es-recovery-intent";
export const RECOVERY_INTENT_MAX_AGE_SECONDS = 60 * 60;

export const RESET_PATH = "/auth/reset";

export function parseOtpType(value: string | null): CallbackOtpType | null {
  return OTP_TYPES.find((type) => type === value) ?? null;
}

/**
 * Email templates build `{{ .RedirectTo }}?token_hash=…&type=…` (ADR 0019), so
 * an email sent without a redirect (for example from the Supabase Dashboard)
 * lands on the Site URL root. That one shape is forwarded to the callback,
 * which verifies it; anything else on the root is ignored.
 */
export function rootEmailLinkRedirect(query: {
  token_hash?: string | string[];
  type?: string | string[];
}): string | null {
  const tokenHash =
    typeof query.token_hash === "string" ? query.token_hash : null;
  const type = parseOtpType(typeof query.type === "string" ? query.type : null);
  if (!tokenHash || !type || !/^[A-Za-z0-9_-]{8,512}$/.test(tokenHash)) {
    return null;
  }
  return `/auth/callback?${new URLSearchParams({ token_hash: tokenHash, type })}`;
}

/**
 * Where a verified Auth email link should land. Recovery and invitation links
 * always go to the password page; so does a PKCE `code` when this browser asked
 * for a recovery (the intent cookie) or the link carries the explicit
 * `next=/auth/reset` of an earlier email. Everything else stays inside /admin.
 */
export function resolveCallbackDestination(input: {
  next: string | null;
  type: CallbackOtpType | null;
  recoveryIntent: boolean;
}): string {
  if (
    input.type === "recovery" ||
    input.type === "invite" ||
    input.next === RESET_PATH ||
    (input.recoveryIntent && !input.type)
  ) {
    return RESET_PATH;
  }
  return safeAdminReturnPath(input.next);
}

export type LinkFailure = "expired" | "invalid";

/** `otp_expired` is the only failure the user can fix by asking again with a hint. */
export function classifyLinkFailure(
  error: { code?: string; message?: string } | null | undefined
): LinkFailure {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return text.includes("expired") ? "expired" : "invalid";
}

export function callbackFailureDestination(
  destination: string,
  failure: LinkFailure
): string {
  return destination === RESET_PATH
    ? `/admin/recovery?link=${failure}`
    : "/admin/login?auth=failed";
}

/**
 * Fragment errors Supabase appends to the redirect, such as
 * `#error=access_denied&error_code=otp_expired`, and the implicit-flow token
 * fragment `#access_token=...&type=recovery`. Pure so it can be tested; the
 * browser relay in components/auth/auth-hash-relay.tsx calls it.
 */
export type HashRelayDecision =
  | { kind: "ignore" }
  | { kind: "error"; failure: LinkFailure }
  | {
      kind: "session";
      accessToken: string;
      refreshToken: string;
    };

export function readAuthHash(hash: string): HashRelayDecision {
  if (!hash || hash === "#") return { kind: "ignore" };
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const type = params.get("type");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (
    accessToken &&
    refreshToken &&
    (type === "recovery" || type === "invite")
  ) {
    return { kind: "session", accessToken, refreshToken };
  }
  if (params.get("error") || params.get("error_code")) {
    const text = `${params.get("error_code") ?? ""} ${params.get("error_description") ?? ""}`;
    return {
      kind: "error",
      failure: text.toLowerCase().includes("expired") ? "expired" : "invalid",
    };
  }
  return { kind: "ignore" };
}

/**
 * Auth email failures worth telling the user about. Everything else stays
 * generic so the recovery form never reveals whether an account exists.
 */
export type AuthEmailProblem = "EMAIL_RATE_LIMIT" | "SMTP_UNAVAILABLE";

export function classifyAuthEmailError(
  error: { status?: number; code?: string; message?: string } | null | undefined
): AuthEmailProblem | null {
  if (!error) return null;
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (
    error.status === 429 ||
    text.includes("rate_limit") ||
    text.includes("rate limit")
  ) {
    return "EMAIL_RATE_LIMIT";
  }
  if (
    (error.status ?? 0) >= 500 ||
    text.includes("smtp") ||
    text.includes("sending") ||
    text.includes("unexpected_failure")
  ) {
    return "SMTP_UNAVAILABLE";
  }
  return null;
}

export const AUTH_EMAIL_PROBLEM_MESSAGES: Record<AuthEmailProblem, string> = {
  EMAIL_RATE_LIMIT:
    "Email delivery is temporarily limited. Use the Technical password-reset option or try again later.",
  SMTP_UNAVAILABLE: "Authentication email delivery is temporarily unavailable.",
};

export const RECOVERY_EXPIRED_MESSAGE =
  "This password-reset link has expired. Request a new one.";
export const PASSWORD_UPDATE_FAILED_MESSAGE =
  "The password could not be updated. Try again.";

/** Minimum password policy shared by the reset page and the Technical fallback. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export function validateNewPassword(
  password: string | null,
  confirmation: string | null
): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return "That password is too long.";
  }
  if (confirmation !== password) {
    return "The two passwords do not match.";
  }
  return null;
}
