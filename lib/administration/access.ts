import "server-only";

import { getManagerContext, type Manager } from "@/lib/auth/manager";
import { can, canAny, type PermissionKey } from "@/lib/auth/permissions";

/**
 * The signed-in person when they hold `key` (society-wide, or for `committeeId`), re-checked for
 * this request. It mirrors the database (ADR 0027); every routine checks again.
 */
export async function requirePermission(
  key: PermissionKey,
  committeeId?: string | null
): Promise<Manager | null> {
  const actor = await getManagerContext();
  if (actor.kind !== "manager" || !can(actor, key, committeeId)) return null;
  return actor;
}

/** The signed-in person when they hold any of `keys`, in any scope (an entry point). */
export async function requireAnyPermission(
  ...keys: PermissionKey[]
): Promise<Manager | null> {
  const actor = await getManagerContext();
  if (actor.kind !== "manager" || !keys.some((key) => canAny(actor, key)))
    return null;
  return actor;
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function formText(form: FormData, name: string) {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}
