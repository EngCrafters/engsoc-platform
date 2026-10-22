"use server";

import { redirect } from "next/navigation";
import { getManagerContext } from "@/lib/auth/manager";
import { logServerError } from "@/lib/api/log";
import { decideProfileChange } from "@/lib/members/profile";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reviewer's decision on a member's correction; the database checks who may decide. */
export async function decideCorrectionAction(form: FormData) {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") redirect("/admin/login");
  const request = form.get("request");
  const decision = form.get("decision");
  const note = form.get("note");
  let code = "VALIDATION_ERROR";
  if (
    typeof request === "string" &&
    UUID.test(request) &&
    (decision === "approve" || decision === "reject") &&
    (note === null || (typeof note === "string" && note.length <= 500))
  ) {
    try {
      code = (
        await decideProfileChange(
          manager.userId,
          request,
          decision,
          typeof note === "string" && note.trim() ? note.trim() : null
        )
      ).code;
    } catch (error) {
      logServerError("profile_correction_failed", error);
      code = "SERVER_ERROR";
    }
  }
  redirect(`/admin/membership?corrections=${encodeURIComponent(code)}`);
}
