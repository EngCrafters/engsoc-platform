"use server";

import { redirect } from "next/navigation";
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

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
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

  const supabase = await createAuthServerClient();
  // Keep the result generic to avoid account enumeration. Supabase applies its
  // own recovery rate limits.
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { status: "sent" };
}

export async function logoutAction() {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
