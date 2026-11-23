"use server";

import { revalidatePath } from "next/cache";
import { isUuid, requirePermission } from "@/lib/administration/access";
import {
  PERMISSION_MESSAGES,
  setGroupPermissions,
  type GroupPermission,
} from "@/lib/administration/permissions";
import { PERMISSION_KEYS } from "@/lib/auth/permissions";
import { logServerError } from "@/lib/api/log";

export type PermissionActionState = {
  code: string;
  message: string;
  permissions?: GroupPermission[];
} | null;

function parseSet(raw: FormDataEntryValue | null): GroupPermission[] | null {
  if (typeof raw !== "string" || raw.length > 10_000) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length > PERMISSION_KEYS.length)
      return null;
    const set: GroupPermission[] = [];
    for (const item of value) {
      const key = (item as { key?: unknown })?.key;
      const scope = (item as { scope?: unknown })?.scope;
      if (
        typeof key !== "string" ||
        !(PERMISSION_KEYS as readonly string[]).includes(key) ||
        (scope !== "all" && scope !== "own")
      )
        return null;
      set.push({ key, scope });
    }
    return set;
  } catch {
    return null;
  }
}

/**
 * Saves one committee's or team's permissions (ADR 0027). permissions.manage is checked here and
 * again, with the self-change, confirmation and recovery-account rules, by the routine.
 */
export async function saveGroupPermissionsAction(
  _previous: PermissionActionState,
  form: FormData
): Promise<PermissionActionState> {
  const actor = await requirePermission("permissions.manage");
  if (!actor)
    return { code: "FORBIDDEN", message: PERMISSION_MESSAGES.FORBIDDEN };
  const kind = form.get("kind");
  const id = form.get("id");
  const permissions = parseSet(form.get("permissions"));
  const previous = parseSet(form.get("previous"));
  const note = form.get("note");
  if (
    (kind !== "committee" && kind !== "team") ||
    !isUuid(id) ||
    !permissions ||
    !previous ||
    (note !== null && (typeof note !== "string" || note.length > 500))
  )
    return {
      code: "VALIDATION_ERROR",
      message: PERMISSION_MESSAGES.VALIDATION_ERROR,
    };
  try {
    const result = await setGroupPermissions({
      actor: actor.userId,
      kind,
      id,
      permissions,
      previous,
      confirmed: form.get("confirmed") === "true",
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    });
    if (result.code === "SUCCESS") {
      revalidatePath("/admin/administration/permissions");
      revalidatePath(`/admin/administration/permissions/${kind}/${id}`);
      // Leaders' navigation and pages follow on their next request.
      revalidatePath("/admin", "layout");
    }
    return {
      code: result.code,
      message:
        PERMISSION_MESSAGES[result.code] ?? PERMISSION_MESSAGES.SERVER_ERROR,
      ...(Array.isArray(result.permissions)
        ? { permissions: result.permissions as GroupPermission[] }
        : {}),
    };
  } catch (error) {
    logServerError("permission_change_failed", error);
    return { code: "SERVER_ERROR", message: PERMISSION_MESSAGES.SERVER_ERROR };
  }
}
