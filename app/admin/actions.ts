"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_EMAIL_PROBLEM_MESSAGES,
  RECOVERY_INTENT_COOKIE,
  RECOVERY_INTENT_MAX_AGE_SECONDS,
  classifyAuthEmailError,
} from "@/lib/auth/callback";
import { authRedirectUrl, createAuthServerClient } from "@/lib/auth/server";
import { safeAdminReturnPath } from "@/lib/auth/paths";
import type { LoginActionState, RecoveryActionState } from "./action-state";

function singleValue(formData: FormData, field: string) {
  const values = formData.getAll(field);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim();
}

function validEmail(value: string | null): value is string {
  return value !== null && value.length <= 320 && /^\S+@\S+\.\S+$/.test(value);
}

export async function loginAction(
  _previous: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const email = singleValue(formData, "email");
  const password = singleValue(formData, "password");
  const next = safeAdminReturnPath(singleValue(formData, "next"));

  if (!validEmail(email) || !password || password.length > 1024) {
    return {
      status: "error",
      message: "Enter your email address and password.",
    };
  }

  let error;
  try {
    const supabase = await createAuthServerClient();
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  } catch {
    return {
      status: "error",
      message:
        "Sign-in is temporarily unavailable. Wait a moment and try again.",
    };
  }
  if (error) {
    // Auth deliberately gives the same response for a nonexistent account and
    // an incorrect password.
    return {
      status: "error",
      message: "We couldn't sign you in with those details.",
    };
  }

  redirect(next);
}

export async function requestRecoveryAction(
  _previous: RecoveryActionState,
  formData: FormData
): Promise<RecoveryActionState> {
  const email = singleValue(formData, "email");
  const redirectTo = authRedirectUrl();

  if (!validEmail(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }
  if (!redirectTo) {
    return {
      status: "error",
      message:
        "Password recovery is temporarily unavailable. Contact the platform maintenance authority.",
    };
  }

  // The result stays generic so this form never reveals whether an account
  // exists. Only delivery problems (rate limit, SMTP) are reported, because
  // they are about the mail system, not about the address.
  try {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    const problem = classifyAuthEmailError(error);
    if (problem) {
      return { status: "error", message: AUTH_EMAIL_PROBLEM_MESSAGES[problem] };
    }
    // The PKCE verifier lives in this browser. The marker tells the callback
    // that a `code` arriving here is the recovery we just requested.
    (await cookies()).set(RECOVERY_INTENT_COOKIE, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_INTENT_MAX_AGE_SECONDS,
    });
  } catch {
    return {
      status: "error",
      message:
        "Recovery is temporarily unavailable. Wait a moment and try again.",
    };
  }
  return { status: "sent" };
}

export async function logoutAction() {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
