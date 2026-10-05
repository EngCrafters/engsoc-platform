import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, close, maintenanceDb, runtimeDb } from "./helpers";

describe("Technical Auth user directory and Auth admin audit", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const maintenance = maintenanceDb();
  afterAll(async () => close(admin, runtime, maintenance));

  const technical = randomUUID();
  const board = randomUUID();
  const invited = randomUUID();
  const confirmed = randomUUID();

  beforeAll(async () => {
    await admin`INSERT INTO auth.users
      (id, email, email_confirmed_at, last_sign_in_at, invited_at) VALUES
      (${technical}, 'dir-tech@example.test', now(), now(), NULL),
      (${board}, 'dir-board@example.test', now(), NULL, NULL),
      (${invited}, 'dir-invited@example.test', NULL, NULL, now()),
      (${confirmed}, 'dir-confirmed@example.test', now(), now(), NULL)`;
    await maintenance`SELECT private.set_technical_access(${technical}::uuid, ${technical}::uuid, true)`;
    await runtime`SELECT private.change_administrative_access(
      ${technical}::uuid, ${board}::uuid, 'BOARD_ADMIN', NULL, 'grant')`;
  });

  it("shows identity state to the Technical Team only", async () => {
    const rows = await runtime<
      {
        user_id: string;
        email_confirmed: boolean;
        invited: boolean;
        last_sign_in_at: Date | null;
      }[]
    >`SELECT * FROM private.list_auth_directory(${technical}::uuid)`;
    const byId = new Map(rows.map((row) => [row.user_id, row]));
    expect(byId.get(invited)).toMatchObject({
      email_confirmed: false,
      invited: true,
      last_sign_in_at: null,
    });
    expect(byId.get(confirmed)).toMatchObject({
      email_confirmed: true,
      invited: false,
    });
    expect(byId.get(confirmed)?.last_sign_in_at).not.toBeNull();

    for (const actor of [board, confirmed, randomUUID()]) {
      const denied = await runtime`
        SELECT * FROM private.list_auth_directory(${actor}::uuid)`;
      expect(denied).toHaveLength(0);
    }
  });

  it("never exposes password, hash or token columns through the directory", async () => {
    const [row] = await runtime<Record<string, unknown>[]>`
      SELECT * FROM private.list_auth_directory(${technical}::uuid) LIMIT 1`;
    expect(Object.keys(row).sort()).toEqual([
      "created_at",
      "email",
      "email_confirmed",
      "invited",
      "last_sign_in_at",
      "user_id",
    ]);
    const columns = await runtime<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'private' AND table_name = 'access_auth_users'`;
    const names = columns.map((column) => column.column_name);
    expect(names).not.toEqual(expect.arrayContaining(["encrypted_password"]));
    expect(names.some((name) => /password|token|hash|secret/.test(name))).toBe(
      false
    );
  });

  it("lets the runtime role call the routines but not read Auth directly", async () => {
    await expect(runtime`SELECT id FROM auth.users LIMIT 1`).rejects.toThrow();
    await expect(
      runtime`SELECT * FROM private.access_auth_users LIMIT 1`
    ).rejects.toThrow();
  });

  it("records Auth admin actions for the Technical Team and rejects everyone else", async () => {
    const ok = await runtime<{ result: { code: string } }[]>`
      SELECT private.record_auth_admin_action(
        ${technical}::uuid, ${invited}::uuid, 'user.invited', 'invitation') AS result`;
    expect(ok[0].result.code).toBe("SUCCESS");
    for (const actor of [board, confirmed]) {
      const denied = await runtime<{ result: { code: string } }[]>`
        SELECT private.record_auth_admin_action(
          ${actor}::uuid, ${invited}::uuid, 'user.invited', NULL) AS result`;
      expect(denied[0].result.code).toBe("FORBIDDEN");
    }
    const missing = await runtime<{ result: { code: string } }[]>`
      SELECT private.record_auth_admin_action(
        ${technical}::uuid, ${randomUUID()}::uuid, 'user.created', NULL) AS result`;
    expect(missing[0].result.code).toBe("USER_NOT_FOUND");
  });

  it("refuses unknown actions and anything that could carry a secret", async () => {
    const rejected = [
      ["user.deleted", null],
      ["user.password_admin_reset", "Hunter2! with symbols"],
      ["user.password_admin_reset", "x".repeat(61)],
      ["user.password_admin_reset", "eyJhbGciOiJIUzI1NiJ9.token"],
    ] as const;
    for (const [action, detail] of rejected) {
      const result = await runtime<{ result: { code: string } }[]>`
        SELECT private.record_auth_admin_action(
          ${technical}::uuid, ${confirmed}::uuid, ${action}::text, ${detail}::text) AS result`;
      expect(result[0].result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("audits a password reset with actor, target and time, and no password field", async () => {
    await runtime`SELECT private.record_auth_admin_action(
      ${technical}::uuid, ${confirmed}::uuid, 'user.password_admin_reset', NULL)`;
    const [row] = await admin<
      {
        actor_user_id: string;
        committee_id: string | null;
        changes: Record<string, unknown>;
        occurred_at: Date;
      }[]
    >`
      SELECT actor_user_id, committee_id, changes, occurred_at
      FROM private.uc02_audit
      WHERE action = 'user.password_admin_reset'
        AND changes->>'userId' = ${confirmed}
      ORDER BY occurred_at DESC LIMIT 1`;
    expect(row.actor_user_id).toBe(technical);
    expect(row.committee_id).toBeNull();
    expect(row.occurred_at).toBeInstanceOf(Date);
    expect(Object.keys(row.changes).sort()).toEqual(["detail", "userId"]);
    expect(JSON.stringify(row.changes)).not.toMatch(/password"|token|secret/i);
  });

  it("returns one user's merged history to the Technical Team only", async () => {
    await runtime`SELECT private.change_administrative_access(
      ${technical}::uuid, ${board}::uuid, 'BOARD_ADMIN', NULL, 'revoke')`;
    const history = await runtime<{ action: string }[]>`
      SELECT action FROM private.list_user_audit(${technical}::uuid, ${board}::uuid)`;
    expect(history.map((row) => row.action)).toEqual(
      expect.arrayContaining(["board_admin.granted", "board_admin.revoked"])
    );
    const resetHistory = await runtime<{ action: string }[]>`
      SELECT action FROM private.list_user_audit(${technical}::uuid, ${confirmed}::uuid)`;
    expect(resetHistory.map((row) => row.action)).toContain(
      "user.password_admin_reset"
    );
    for (const actor of [board, confirmed]) {
      const denied = await runtime`
        SELECT * FROM private.list_user_audit(${actor}::uuid, ${confirmed}::uuid)`;
      expect(denied).toHaveLength(0);
    }
  });
});
