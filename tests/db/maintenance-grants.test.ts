import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, close, maintenanceDb, runtimeDb } from "./helpers";

type Result = { code: string; change?: string; bootstrap?: boolean };

const admin = adminDb();
const maintenance = maintenanceDb();
const runtime = runtimeDb();

afterAll(async () => close(admin, maintenance, runtime));

async function scenario() {
  const committeeId = randomUUID();
  const maintainerId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  await admin`INSERT INTO auth.users (id) VALUES (${maintainerId}), (${firstId}), (${secondId})`;
  await admin`INSERT INTO public.committees (id, name) VALUES (${committeeId}, ${`Committee ${committeeId}`})`;
  return { committeeId, maintainerId, firstId, secondId };
}

async function grant(
  actor: string,
  user: string,
  committee: string,
  note: string | null = null
) {
  const [{ result }] = await maintenance<
    [{ result: Result }]
  >`SELECT private.grant_committee_manager(${actor}, ${user}, ${committee}, ${note}) AS result`;
  return result;
}

async function revoke(actor: string, user: string, committee: string) {
  const [{ result }] = await maintenance<
    [{ result: Result }]
  >`SELECT private.revoke_committee_manager(${actor}, ${user}, ${committee}) AS result`;
  return result;
}

const auditRows = (committeeId: string) =>
  admin<
    {
      action: string;
      actor_kind: string;
      actor_user_id: string;
      changes: Record<string, unknown>;
    }[]
  >`SELECT action, actor_kind, actor_user_id, changes FROM private.uc02_audit WHERE committee_id = ${committeeId} ORDER BY occurred_at, id`;

const grantRow = async (userId: string, committeeId: string) =>
  (
    await admin<
      {
        granted_by: string;
        revoked_at: Date | null;
        revoked_by: string | null;
      }[]
    >`SELECT granted_by, revoked_at, revoked_by FROM public.committee_managers WHERE user_id = ${userId} AND committee_id = ${committeeId}`
  )[0];

describe("maintenance grant routine", () => {
  it("grants access and writes one maintenance audit row atomically", async () => {
    const s = await scenario();
    const result = await grant(
      s.maintainerId,
      s.firstId,
      s.committeeId,
      "  first Events manager  "
    );
    expect(result).toEqual({
      code: "SUCCESS",
      change: "granted",
      bootstrap: true,
    });

    expect((await grantRow(s.firstId, s.committeeId)).granted_by).toBe(
      s.maintainerId
    );
    const audit = await auditRows(s.committeeId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "grant.activated",
      actor_kind: "maintenance",
      actor_user_id: s.maintainerId,
      changes: {
        userId: s.firstId,
        change: "granted",
        bootstrap: true,
        note: "first Events manager",
      },
    });
  });

  it("marks only the committee's first active grant as bootstrap", async () => {
    const s = await scenario();
    await grant(s.maintainerId, s.firstId, s.committeeId);
    const second = await grant(s.maintainerId, s.secondId, s.committeeId);
    expect(second).toMatchObject({ code: "SUCCESS", bootstrap: false });
    const audit = await auditRows(s.committeeId);
    expect(audit.map((row) => row.changes.bootstrap)).toEqual([true, false]);
  });

  it("supports a maintainer granting their own first manager access", async () => {
    const s = await scenario();
    const result = await grant(
      s.firstId,
      s.firstId,
      s.committeeId,
      "bootstrap"
    );
    expect(result).toMatchObject({ code: "SUCCESS", bootstrap: true });
    const audit = await auditRows(s.committeeId);
    expect(audit[0]).toMatchObject({
      actor_kind: "maintenance",
      actor_user_id: s.firstId,
    });
  });

  it("treats a duplicate active grant as a no-op without a second audit row", async () => {
    const s = await scenario();
    await grant(s.maintainerId, s.firstId, s.committeeId);
    const before = await grantRow(s.firstId, s.committeeId);
    expect(await grant(s.maintainerId, s.firstId, s.committeeId)).toEqual({
      code: "ALREADY_ACTIVE",
    });
    expect(await grantRow(s.firstId, s.committeeId)).toEqual(before);
    expect(await auditRows(s.committeeId)).toHaveLength(1);
  });

  it("rejects unknown committee, user and actor without partial writes", async () => {
    const s = await scenario();
    expect(await grant(s.maintainerId, s.firstId, randomUUID())).toEqual({
      code: "COMMITTEE_NOT_FOUND",
    });
    expect(await grant(s.maintainerId, randomUUID(), s.committeeId)).toEqual({
      code: "USER_NOT_FOUND",
    });
    expect(await grant(randomUUID(), s.firstId, s.committeeId)).toEqual({
      code: "ACTOR_NOT_FOUND",
    });
    expect(await grantRow(s.firstId, s.committeeId)).toBeUndefined();
    expect(await auditRows(s.committeeId)).toHaveLength(0);
  });

  it("validates required arguments and note length", async () => {
    const s = await scenario();
    const [{ result: nullActor }] = await maintenance<
      [{ result: Result }]
    >`SELECT private.grant_committee_manager(NULL, ${s.firstId}, ${s.committeeId}) AS result`;
    expect(nullActor.code).toBe("VALIDATION_ERROR");
    expect(
      await grant(s.maintainerId, s.firstId, s.committeeId, "x".repeat(201))
    ).toEqual({ code: "VALIDATION_ERROR" });
    expect(await grantRow(s.firstId, s.committeeId)).toBeUndefined();
  });

  it("rolls the grant back if the audit write fails", async () => {
    const s = await scenario();
    const constraint = `audit_probe_${s.committeeId.replaceAll("-", "")}`;
    await admin.unsafe(
      `ALTER TABLE private.uc02_audit ADD CONSTRAINT ${constraint} CHECK ((changes->>'note') IS DISTINCT FROM 'audit-must-fail') NOT VALID`
    );
    try {
      await expect(
        grant(s.maintainerId, s.firstId, s.committeeId, "audit-must-fail")
      ).rejects.toMatchObject({ code: "23514" });
      expect(await grantRow(s.firstId, s.committeeId)).toBeUndefined();
      expect(await auditRows(s.committeeId)).toHaveLength(0);
    } finally {
      await admin.unsafe(
        `ALTER TABLE private.uc02_audit DROP CONSTRAINT ${constraint}`
      );
    }
  });
});

describe("maintenance revoke routine", () => {
  it("revokes an active grant, retains the row and audits it", async () => {
    const s = await scenario();
    await grant(s.maintainerId, s.firstId, s.committeeId);
    expect(await revoke(s.maintainerId, s.firstId, s.committeeId)).toEqual({
      code: "SUCCESS",
      change: "revoked",
    });
    const row = await grantRow(s.firstId, s.committeeId);
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoked_by).toBe(s.maintainerId);
    const audit = await auditRows(s.committeeId);
    expect(audit.map((entry) => entry.action)).toEqual([
      "grant.activated",
      "grant.revoked",
    ]);
    expect(audit[1]).toMatchObject({
      actor_kind: "maintenance",
      actor_user_id: s.maintainerId,
      changes: { userId: s.firstId },
    });
  });

  it("handles repeat and nonexistent revocations without new audit rows", async () => {
    const s = await scenario();
    expect(await revoke(s.maintainerId, s.firstId, s.committeeId)).toEqual({
      code: "NOT_FOUND",
    });
    await grant(s.maintainerId, s.firstId, s.committeeId);
    await revoke(s.maintainerId, s.firstId, s.committeeId);
    expect(await revoke(s.maintainerId, s.firstId, s.committeeId)).toEqual({
      code: "ALREADY_REVOKED",
    });
    expect(await auditRows(s.committeeId)).toHaveLength(2);
  });

  it("does not revoke when the actor identity is unknown", async () => {
    const s = await scenario();
    await grant(s.maintainerId, s.firstId, s.committeeId);
    expect(await revoke(randomUUID(), s.firstId, s.committeeId)).toEqual({
      code: "ACTOR_NOT_FOUND",
    });
    expect((await grantRow(s.firstId, s.committeeId)).revoked_at).toBeNull();
    expect(await auditRows(s.committeeId)).toHaveLength(1);
  });

  it("reactivates a revoked grant and records the previous state", async () => {
    const s = await scenario();
    await grant(s.maintainerId, s.firstId, s.committeeId);
    await revoke(s.maintainerId, s.firstId, s.committeeId);
    expect(await grant(s.maintainerId, s.firstId, s.committeeId)).toMatchObject(
      { code: "SUCCESS", change: "reactivated" }
    );
    const row = await grantRow(s.firstId, s.committeeId);
    expect(row.revoked_at).toBeNull();
    expect(row.revoked_by).toBeNull();
    const audit = await auditRows(s.committeeId);
    expect(audit).toHaveLength(3);
    expect(audit[2].changes).toMatchObject({
      change: "reactivated",
      previous: { revokedBy: s.maintainerId },
    });
  });
});

describe("maintenance routine access boundary", () => {
  const routines = [
    "private.grant_committee_manager(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())",
    "private.revoke_committee_manager(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())",
  ];

  it("denies app_runtime execution of both routines", async () => {
    for (const call of routines) {
      await expect(runtime.unsafe(`SELECT ${call}`)).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("denies anon, authenticated and service_role execution", async () => {
    const connection = await admin.reserve();
    try {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await connection.unsafe(`SET ROLE ${role}`);
        try {
          for (const call of routines) {
            await expect(
              connection.unsafe(`SELECT ${call}`)
            ).rejects.toMatchObject({ code: "42501" });
          }
        } finally {
          await connection.unsafe("RESET ROLE");
        }
      }
    } finally {
      connection.release();
    }
  });

  it("no longer lets app_maintenance write grants or audit directly", async () => {
    const s = await scenario();
    await expect(
      maintenance`INSERT INTO public.committee_managers (user_id, committee_id, granted_by) VALUES (${s.firstId}, ${s.committeeId}, ${s.maintainerId})`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      maintenance`UPDATE public.committee_managers SET revoked_at = now() WHERE false`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      maintenance`INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes) VALUES (${s.committeeId}, 'maintenance', ${s.maintainerId}, 'grant.activated', '{}')`
    ).rejects.toMatchObject({ code: "42501" });
    // Read access for verification is retained.
    await expect(
      maintenance`SELECT count(*) FROM public.committee_managers`
    ).resolves.toBeDefined();
  });
});
