"use server";

import { revalidatePath } from "next/cache";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import { changeAccess, replaceManager } from "@/lib/access/server";
import { ACCESS_ERROR_MESSAGES as MESSAGES } from "@/lib/access/messages";
import { isUuid } from "@/lib/admin-events/types";

export type AccessActionState = { message: string; success: boolean };

/** The signed-in person when they may change access: 'full' for every role, else managers only. */
async function accountActor() {
  const actor = await getManagerContext();
  if (actor.kind !== "manager") return null;
  const full = can(actor, "accounts.admin_levels");
  if (!full && !can(actor, "accounts.manage")) return null;
  return { userId: actor.userId, full };
}

function field(form: FormData, name: string) {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

export async function changeAccessAction(
  _previous: AccessActionState,
  form: FormData
): Promise<AccessActionState> {
  // Manage administrator access covers every role; Manage committee access, Committee Managers
  // only (ADR 0027). The database applies the same rule to the live actor.
  const actor = await accountActor();
  if (!actor) return { success: false, message: MESSAGES.FORBIDDEN };
  const userId = field(form, "userId");
  const level = field(form, "level");
  const committeeId = field(form, "committeeId");
  const operation = field(form, "operation");
  const note = field(form, "note");
  if (!actor.full && level !== "COMMITTEE_MANAGER") {
    return { success: false, message: MESSAGES.FORBIDDEN };
  }
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
    if (result.code === "SUCCESS") revalidatePath("/admin", "layout");
    return {
      success: result.code === "SUCCESS",
      message:
        MESSAGES[
          operation === "revoke" && result.code === "NOT_FOUND"
            ? "ACCESS_ALREADY_REVOKED"
            : result.code
        ] ?? "Access could not be updated.",
    };
  } catch {
    return {
      success: false,
      message: "Access could not be updated. Try again.",
    };
  }
}

export async function replaceManagerAction(
  _previous: AccessActionState,
  form: FormData
): Promise<AccessActionState> {
  const actor = await accountActor();
  if (!actor) return { success: false, message: MESSAGES.FORBIDDEN };
  const oldUserId = field(form, "oldUserId");
  const newUserId = field(form, "newUserId");
  const committeeId = field(form, "committeeId");
  const note = field(form, "note");
  if (
    !oldUserId ||
    !isUuid(oldUserId) ||
    !newUserId ||
    !isUuid(newUserId) ||
    oldUserId === newUserId ||
    !committeeId ||
    !isUuid(committeeId) ||
    note === null ||
    note.length > 200
  ) {
    return {
      success: false,
      message: "Choose the current manager, replacement and committee.",
    };
  }
  try {
    const result = await replaceManager({
      actorId: actor.userId,
      oldUserId,
      newUserId,
      committeeId,
      note: note || null,
    });
    if (result.code === "SUCCESS") revalidatePath("/admin", "layout");
    return {
      success: result.code === "SUCCESS",
      message:
        result.code === "SUCCESS"
          ? "Manager replaced. Previous access is revoked and history is preserved."
          : (MESSAGES[result.code] ?? "The manager could not be replaced."),
    };
  } catch {
    return {
      success: false,
      message:
        "The replacement result could not be confirmed. Refresh the user list before trying again.",
    };
  }
}
