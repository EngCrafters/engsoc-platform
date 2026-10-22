import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { AccessLevel } from "@/lib/auth/manager";

export type AccessRow = {
  user_id: string;
  email: string | null;
  access_level: AccessLevel;
  committee_id: string | null;
  committee_name: string | null;
  active: boolean;
  /** Set only when inactive: a suspension can be reactivated, a revocation cannot (ADR 0024). */
  revocation_kind: "revoked" | "suspended" | null;
  granted_at: string;
  revoked_at: string | null;
};

export async function listAccess(actorId: string) {
  return db.execute<AccessRow>(
    sql`SELECT * FROM private.list_administrative_access(${actorId}::uuid)`
  );
}

export async function listAvailableUsers(actorId: string) {
  return db.execute<{ user_id: string; email: string }>(
    sql`SELECT * FROM private.list_auth_users_for_access(${actorId}::uuid)`
  );
}

export async function listAccessAudit(actorId: string) {
  return db.execute<{
    id: string;
    occurred_at: string;
    actor_user_id: string | null;
    target_user_id: string;
    action: string;
    committee_id: string | null;
    previous_state: unknown;
    new_state: unknown;
    note: string | null;
  }>(sql`SELECT * FROM private.list_access_audit(${actorId}::uuid)`);
}

export async function changeAccess(input: {
  actorId: string;
  userId: string;
  level: AccessLevel;
  committeeId: string | null;
  operation: "grant" | "reassign" | "revoke";
  note: string | null;
}) {
  const rows =
    input.level === "TECHNICAL"
      ? await db.execute<{ result: { code: string } }>(sql`
          SELECT private.change_technical_access(
            ${input.actorId}::uuid, ${input.userId}::uuid,
            ${input.operation}::text, ${input.note}::text
          ) AS result
        `)
      : await db.execute<{ result: { code: string } }>(sql`
    SELECT private.change_administrative_access(
      ${input.actorId}::uuid, ${input.userId}::uuid,
      ${input.level}::public.administrative_access_level,
      ${input.committeeId}::uuid, ${input.operation}::text,
      ${input.note}::text
    ) AS result
  `);
  return rows[0]?.result ?? { code: "UNAVAILABLE" };
}

export type AuthDirectoryRow = {
  user_id: string;
  email: string;
  email_confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  invited: boolean;
};

/** One transaction swaps the selected manager and records both target histories. */
export async function replaceManager(input: {
  actorId: string;
  oldUserId: string;
  newUserId: string;
  committeeId: string;
  note: string | null;
}) {
  const rows = await db.execute<{ result: { code: string } }>(sql`
    SELECT private.replace_committee_manager(
      ${input.actorId}::uuid, ${input.oldUserId}::uuid,
      ${input.newUserId}::uuid, ${input.committeeId}::uuid,
      ${input.note}::text
    ) AS result
  `);
  return rows[0]?.result ?? { code: "UNAVAILABLE" };
}

/** Identity state only: never passwords, hashes or tokens. */
export async function listAuthDirectory(actorId: string) {
  return db.execute<AuthDirectoryRow>(
    sql`SELECT * FROM private.list_auth_directory(${actorId}::uuid)`
  );
}

export type UserAuditRow = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  committee_id: string | null;
  previous_state: unknown;
  new_state: unknown;
  note: string | null;
};

export async function listUserAudit(actorId: string, targetId: string) {
  return db.execute<UserAuditRow>(
    sql`SELECT * FROM private.list_user_audit(${actorId}::uuid, ${targetId}::uuid)`
  );
}

export type AuthAdminAction =
  | "user.created"
  | "user.invited"
  | "user.invitation_resent"
  | "user.password_reset_sent"
  | "user.password_admin_reset";

/** Audit label only. `detail` is a short fixed word, never a secret. */
export async function recordAuthAdminAction(input: {
  actorId: string;
  targetId: string;
  action: AuthAdminAction;
  detail?: string;
}) {
  const rows = await db.execute<{ result: { code: string } }>(sql`
    SELECT private.record_auth_admin_action(
      ${input.actorId}::uuid, ${input.targetId}::uuid,
      ${input.action}::text, ${input.detail ?? null}::text
    ) AS result
  `);
  return rows[0]?.result ?? { code: "UNAVAILABLE" };
}
