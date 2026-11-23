import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { withRecoveryGuard } from "@/lib/auth/recovery";

/**
 * Committee and team permissions (ADR 0027, migration 0035). Every routine checks
 * permissions.manage for the live actor; nothing here trusts the browser.
 */

export type GroupPermission = { key: string; scope: "all" | "own" };
export type CatalogEntry = {
  key: string;
  area: string;
  label: string;
  description: string;
  scopable: boolean;
};
export type GroupSummary = {
  id: string;
  name: string;
  slug: string | null;
  archived: boolean;
  permissions: GroupPermission[];
  leaders: number;
  managers: number;
  teams: {
    id: string;
    name: { en: string; ar: string | null };
    status: "active" | "inactive";
    permissions: GroupPermission[];
    leaders: number;
  }[];
};
export type PermissionGroups = {
  catalog: CatalogEntry[];
  levels: Partial<
    Record<"BOARD_ADMIN" | "TECHNICAL" | "COMMITTEE_MANAGER", GroupPermission[]>
  >;
  committees: GroupSummary[];
};
export type PermissionGroup = {
  group: {
    kind: "committee" | "team";
    id: string;
    name: string;
    nameAr: string | null;
    committee: { id: string; name: string; archived: boolean };
    status: string;
  };
  permissions: GroupPermission[];
  catalog: CatalogEntry[];
  /** The actor holds access through this group, so they cannot change it. */
  self: boolean;
  holders: {
    memberId: string;
    name: string | null;
    email: string;
    source: "appointment" | "manager";
    position: { id: string; label: { en: string; ar: string } } | null;
  }[];
  history: {
    id: string;
    at: string;
    actorEmail: string | null;
    previous: GroupPermission[];
    next: GroupPermission[];
    note: string | null;
  }[];
};

type Result = { code: string } & Record<string, unknown>;

async function call(query: ReturnType<typeof sql>): Promise<Result> {
  const rows = await withRecoveryGuard(() =>
    db.execute<{ result: Result }>(query)
  );
  if (!Array.isArray(rows)) return rows as Result;
  if (!rows.length) throw new Error("Permission routine unavailable");
  return rows[0].result;
}

export async function listPermissionGroups(
  actor: string
): Promise<PermissionGroups | null> {
  const result = await call(
    sql`SELECT private.list_permission_groups(${actor}::uuid) AS result`
  );
  return result.code === "SUCCESS"
    ? (result as unknown as PermissionGroups)
    : null;
}

export async function getPermissionGroup(
  actor: string,
  kind: "committee" | "team",
  id: string
): Promise<PermissionGroup | { code: string }> {
  const result = await call(
    sql`SELECT private.get_permission_group(${actor}::uuid,
      ${kind === "committee" ? id : null}::uuid, ${kind === "team" ? id : null}::uuid) AS result`
  );
  return result.code === "SUCCESS"
    ? (result as unknown as PermissionGroup)
    : { code: result.code };
}

/**
 * Replaces a group's permissions. `previous` is what the editor loaded (STALE_REVISION if it
 * changed); full access or a change to permissions.manage needs `confirmed`.
 */
export const setGroupPermissions = (input: {
  actor: string;
  kind: "committee" | "team";
  id: string;
  permissions: GroupPermission[];
  previous: GroupPermission[];
  confirmed: boolean;
  note: string | null;
}) =>
  call(sql`SELECT private.set_group_permissions(${input.actor}::uuid,
    ${input.kind === "committee" ? input.id : null}::uuid,
    ${input.kind === "team" ? input.id : null}::uuid,
    ${JSON.stringify(input.permissions)}::text::jsonb,
    ${JSON.stringify(input.previous)}::text::jsonb,
    ${input.confirmed}::boolean, ${input.note}::text) AS result`);

export const PERMISSION_MESSAGES: Record<string, string> = {
  SUCCESS: "Permissions saved.",
  UNCHANGED: "Nothing changed.",
  FORBIDDEN: "You need the Manage permissions permission to change this.",
  NOT_FOUND: "This committee or team no longer exists.",
  SELF_CHANGE:
    "You hold access through this committee or team, so someone else must change its permissions.",
  STALE_REVISION:
    "Someone else changed these permissions. Review the current ones and try again.",
  CONFIRMATION_REQUIRED:
    "Confirm this change: it grants full access or changes who can manage permissions.",
  LAST_RECOVERY_ACCOUNT:
    "This would leave no account able to manage permissions and administrator access. Give that access to someone else first.",
  VALIDATION_ERROR: "Check the selected permissions and try again.",
  SERVER_ERROR:
    "The change could not be confirmed. Refresh before trying again.",
};
