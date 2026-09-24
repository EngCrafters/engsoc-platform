"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/auth/server";
import type { ResetActionState } from "./action-state";

export async function resetPasswordAction(
  _previous: ResetActionState,
  formData: FormData
): Promise<ResetActionState> {
  const values = formData.getAll("password");
  const password =
    values.length === 1 && typeof values[0] === "string" ? values[0] : null;
  if (!password || password.length < 12 || password.length > 1024) {
    return {
      status: "error",
      message: "Use a password with at least 12 characters.",
    };
  }
  let error;
  try {
    const supabase = await createAuthServerClient();
    ({ error } = await supabase.auth.updateUser({ password }));
  } catch {
    return {
      status: "error",
      message:
        "The password reset service is temporarily unavailable. Request a new recovery email and try again.",
    };
  }
  if (error)
    return {
      status: "error",
      message:
        "We couldn't reset your password. Request a new recovery email and try again.",
    };
  redirect("/admin/events");
}
