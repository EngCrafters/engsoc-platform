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
