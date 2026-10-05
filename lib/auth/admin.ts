import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authRedirectUrl } from "@/lib/auth/server";
import { classifyAuthEmailError } from "@/lib/auth/callback";

/**
 * Supabase Auth administration, SERVER-SIDE ONLY.
 *
 * Authentication (who someone is) is separate from application access (what
 * they may do): creating or inviting an Auth user grants no dashboard access,
 * and revoking access never deletes the Auth user. Every function here is
 * called only from Technical-only server actions that have already verified
 * the caller; none of them returns a password, token, hash or link.
 *
 * The service-role key is read only in this file and never leaves the server.
 */

export type AuthAdminCode =
  | "SUCCESS"
  | "EMAIL_EXISTS"
  | "USER_NOT_FOUND"
  | "INVALID_INPUT"
  | "PASSWORD_UPDATE_FAILED"
  | "WEAK_PASSWORD"
  | "EMAIL_RATE_LIMIT"
  | "SMTP_UNAVAILABLE"
  | "UNAVAILABLE";

export type AuthAdminResult = { code: AuthAdminCode; userId?: string };

type AuthError = {
  status?: number;
  code?: string;
  message?: string;
} | null;

function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

const STATELESS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

function adminClient(): SupabaseClient | null {
  const config = publicConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !serviceKey) return null;
  return createClient(config.url, serviceKey, { auth: STATELESS });
}

/**
 * A cookie-less client for emails the Technical user triggers on someone
 * else's behalf. It must not use the PKCE flow: that would store a verifier in
 * the Technical user's browser, which could never complete the recipient's
 * link. The recommended email template (see docs/AUTH_AND_EMAIL.md) carries a
 * token hash that works on any device.
 */
function mailClient(): SupabaseClient | null {
  const config = publicConfig();
  return config
    ? createClient(config.url, config.anonKey, {
        auth: { ...STATELESS, flowType: "implicit" },
      })
    : null;
}

export function mapAuthAdminError(error: AuthError): AuthAdminCode {
  if (!error) return "SUCCESS";
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    text.includes("already been registered") ||
    text.includes("already registered")
  ) {
    return "EMAIL_EXISTS";
  }
  if (error.code === "user_not_found") return "USER_NOT_FOUND";
  if (error.code === "weak_password") return "WEAK_PASSWORD";
  const email = classifyAuthEmailError(error);
  if (email) return email;
  if (error.status === 400 || error.status === 422) return "INVALID_INPUT";
  return "UNAVAILABLE";
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_PATTERN.test(value);
}

/** Invite by email: the user receives a link and chooses their own password. */
export async function inviteAuthUser(email: string): Promise<AuthAdminResult> {
  const client = adminClient();
  if (!client || !isPlausibleEmail(email)) {
    return { code: client ? "INVALID_INPUT" : "UNAVAILABLE" };
  }
  try {
    const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
      redirectTo: authRedirectUrl() ?? undefined,
    });
    if (error) return { code: mapAuthAdminError(error) };
    return { code: "SUCCESS", userId: data.user?.id };
  } catch {
    return { code: "UNAVAILABLE" };
  }
}

/**
 * Creates a confirmed account that already has a password, for the pilot
 * fallback when email cannot be relied on. The password is write-only: it is
 * sent to Auth and not returned, stored, logged or audited.
 */
export async function createAuthUserWithPassword(
  email: string,
  password: string
): Promise<AuthAdminResult> {
  const client = adminClient();
  if (!client || !isPlausibleEmail(email)) {
    return { code: client ? "INVALID_INPUT" : "UNAVAILABLE" };
  }
  try {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return { code: mapAuthAdminError(error) };
    return { code: "SUCCESS", userId: data.user?.id };
  } catch {
    return { code: "UNAVAILABLE" };
  }
}

/**
 * Creates a confirmed account with no password and sends no email. The person
 * sets a password later through password recovery or an invitation.
 */
export async function createAuthUserWithoutPassword(
  email: string
): Promise<AuthAdminResult> {
  const client = adminClient();
  if (!client || !isPlausibleEmail(email)) {
    return { code: client ? "INVALID_INPUT" : "UNAVAILABLE" };
  }
  try {
    const { data, error } = await client.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) return { code: mapAuthAdminError(error) };
    return { code: "SUCCESS", userId: data.user?.id };
  } catch {
    return { code: "UNAVAILABLE" };
  }
}

/** Re-sends the invitation to an account that has not accepted it yet. */
export async function resendAuthInvitation(
  email: string
): Promise<AuthAdminResult> {
  const result = await inviteAuthUser(email);
  // An accepted account reports "already registered"; there is nothing to resend.
  return result.code === "EMAIL_EXISTS" ? { code: "INVALID_INPUT" } : result;
}

/** Sends the standard password-reset email to the account's own inbox. */
export async function sendPasswordResetEmail(
  email: string
): Promise<AuthAdminResult> {
  const client = mailClient();
  const redirectTo = authRedirectUrl();
  if (!client || !redirectTo || !isPlausibleEmail(email)) {
    return { code: client && redirectTo ? "INVALID_INPUT" : "UNAVAILABLE" };
  }
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return { code: error ? mapAuthAdminError(error) : "SUCCESS" };
  } catch {
    return { code: "UNAVAILABLE" };
  }
}

/**
 * Sets a temporary password through the supported Admin API. The value is used
 * once and discarded; the result only says whether it worked.
 */
export async function setTemporaryPassword(
  userId: string,
  password: string
): Promise<AuthAdminResult> {
  const client = adminClient();
  if (!client) return { code: "UNAVAILABLE" };
  try {
    const { error } = await client.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (!error) return { code: "SUCCESS" };
    // A password update has nothing to do with mail delivery, so only the
    // password-specific outcomes are distinguished; everything else is generic.
    const code = mapAuthAdminError(error);
    return {
      code:
        code === "WEAK_PASSWORD" || code === "USER_NOT_FOUND"
          ? code
          : "PASSWORD_UPDATE_FAILED",
    };
  } catch {
    return { code: "PASSWORD_UPDATE_FAILED" };
  }
}
