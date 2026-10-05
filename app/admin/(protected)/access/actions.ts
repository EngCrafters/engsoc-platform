"use server";

import { revalidatePath } from "next/cache";
import { getManagerContext } from "@/lib/auth/manager";
import { changeAccess } from "@/lib/access/server";
import { isUuid } from "@/lib/admin-events/types";

export type AccessActionState = { message: string; success: boolean };

const MESSAGES: Record<string, string> = {
  SUCCESS: "Access updated.",
  REASSIGN_REQUIRED:
    "This user already manages another committee. Reassign their committee instead.",
  FORBIDDEN: "This action is available only to the Technical Team.",
  CONFLICT:
    "This user already has a different active access level. Revoke it before granting a new level.",
  ALREADY_ACTIVE: "This access is already active.",
  NOT_FOUND: "No active access assignment was found.",
  USER_NOT_FOUND: "Select an existing authenticated user.",
  COMMITTEE_NOT_FOUND: "Select a valid committee.",
  INVALID_TRANSITION: "This reassignment is not valid.",
  LAST_TECHNICAL_ADMIN:
    "At least one active Technical Team administrator must remain. Grant Technical access to another user before removing this account.",
  SELF_ESCALATION: "You cannot elevate your own account through this action.",
};

export async function changeAccessAction(
  _previous: AccessActionState,
  form: FormData
): Promise<AccessActionState> {
  const actor = await getManagerContext();
  if (actor.kind !== "manager" || actor.accessLevel !== "TECHNICAL") {
    return { success: false, message: MESSAGES.FORBIDDEN };
  }
  const userId = form.get("userId");
  const level = form.get("level");
  const committeeId = form.get("committeeId");
  const operation = form.get("operation");
  const note = form.get("note");
  if (
    typeof userId !== "string" ||
    !isUuid(userId) ||
    (level !== "BOARD_ADMIN" &&
      level !== "COMMITTEE_MANAGER" &&
      level !== "TECHNICAL") ||
    (operation !== "grant" &&
      operation !== "reassign" &&
      operation !== "revoke") ||
    typeof committeeId !== "string" ||
    (committeeId !== "" && !isUuid(committeeId)) ||
    (level === "COMMITTEE_MANAGER" && !isUuid(committeeId)) ||
    (level !== "COMMITTEE_MANAGER" && committeeId !== "") ||
    (level === "TECHNICAL" && operation === "reassign") ||
    typeof note !== "string" ||
    note.length > 200
  ) {
    return {
      success: false,
      message: "Choose a user, role, and valid committee.",
    };
  }
  try {
    const result = await changeAccess({
      actorId: actor.userId,
      userId,
      level,
      committeeId: committeeId || null,
      operation,
      note: note || null,
    });
    if (result.code === "SUCCESS") revalidatePath("/admin/access");
    return {
      success: result.code === "SUCCESS",
      message: MESSAGES[result.code] ?? "Access could not be updated.",
    };
  } catch {
    return {
      success: false,
      message: "Access could not be updated. Try again.",
    };
  }
}
