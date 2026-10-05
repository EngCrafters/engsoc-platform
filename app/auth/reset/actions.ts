"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/auth/server";
import {
  PASSWORD_UPDATE_FAILED_MESSAGE,
  RECOVERY_EXPIRED_MESSAGE,
  validateNewPassword,
} from "@/lib/auth/callback";
import type { ResetActionState } from "./action-state";

function single(formData: FormData, field: string) {
  const values = formData.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

/** Errors from `updateUser` that mean the recovery session is gone or invalid. */
function sessionExpired(error: {
  status?: number;
  code?: string;
  name?: string;
}) {
  return (
    error.name === "AuthSessionMissingError" ||
    error.status === 401 ||
    error.status === 403 ||
    error.code === "session_not_found" ||
    error.code === "session_expired" ||
    error.code === "bad_jwt" ||
    error.code === "no_authorization"
  );
}

/**
 * Sets the new password for the recovery session, then ends that session so
 * the user signs in normally. The password is read, validated, sent to
 * Supabase Auth and forgotten: it is never logged, echoed or returned.
 */
export async function resetPasswordAction(
  _previous: ResetActionState,
  formData: FormData
): Promise<ResetActionState> {
  const password = single(formData, "password");
  const confirmation = single(formData, "confirmPassword");
  const invalid = validateNewPassword(password, confirmation);
  if (invalid || !password) return { status: "error", message: invalid ?? "" };

  let error;
  try {
    const supabase = await createAuthServerClient();
    ({ error } = await supabase.auth.updateUser({ password }));
    if (!error) await supabase.auth.signOut();
  } catch {
    return {
      status: "error",
      message:
        "The password reset service is temporarily unavailable. Try again in a moment.",
    };
  }
  if (error) {
    if (sessionExpired(error)) {
      return { status: "expired", message: RECOVERY_EXPIRED_MESSAGE };
    }
    if (error.code === "same_password") {
      return {
        status: "error",
        message: "Choose a password different from your current one.",
      };
    }
    if (error.code === "weak_password") {
      return {
        status: "error",
        message:
          "That password is too easy to guess. Choose a longer, less common one.",
      };
    }
    return { status: "error", message: PASSWORD_UPDATE_FAILED_MESSAGE };
  }
  redirect("/admin/login?reset=success");
}
