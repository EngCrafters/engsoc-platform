import "server-only";

import { getManagerContext, type ManagerContext } from "@/lib/auth/manager";

export type SeniorContext = Extract<ManagerContext, { kind: "manager" }> & {
  accessLevel: "BOARD_ADMIN" | "TECHNICAL";
};

/**
 * The Administration section's gate: an active Board Administration or Technical Team grant,
 * re-checked for this request. It mirrors the database; every routine checks again.
 */
export async function requireSenior(): Promise<SeniorContext | null> {
  const actor = await getManagerContext();
  if (
    actor.kind !== "manager" ||
    (actor.accessLevel !== "BOARD_ADMIN" && actor.accessLevel !== "TECHNICAL")
  )
    return null;
  return actor as SeniorContext;
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
