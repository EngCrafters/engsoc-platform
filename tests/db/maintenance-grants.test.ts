import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, close, maintenanceDb, runtimeDb } from "./helpers";

const admin = adminDb();
const maintenance = maintenanceDb();
const runtime = runtimeDb();
afterAll(async () => close(admin, maintenance, runtime));

async function users() {
  const actor = randomUUID();
  const target = randomUUID();
  await admin`INSERT INTO auth.users (id) VALUES (${actor}), (${target})`;
  return { actor, target };
}

describe("Technical bootstrap boundary", () => {
  it("allows only maintenance to bootstrap Technical and audits the change", async () => {
    const { actor, target } = await users();
    await expect(
      runtime`SELECT private.set_technical_access(${actor}::uuid, ${target}::uuid, true)`
    ).rejects.toMatchObject({ code: "42501" });
    const [grant] = await maintenance<{ result: { code: string } }[]>`
      SELECT private.set_technical_access(${actor}::uuid, ${target}::uuid, true, 'approved bootstrap') AS result`;
    expect(grant.result.code).toBe("SUCCESS");
    const [row] = await admin<
      { access_level: string; committee_id: string | null }[]
    >`
      SELECT access_level, committee_id FROM public.administrative_access WHERE user_id = ${target}`;
    expect(row).toMatchObject({
      access_level: "TECHNICAL",
      committee_id: null,
    });
    const [audit] = await admin<
      {
        actor_user_id: string;
        changes: { previous: unknown; next: { active: boolean } };
      }[]
    >`
      SELECT actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'access.technical_changed' AND changes->>'userId' = ${target}`;
    expect(audit.actor_user_id).toBe(actor);
    expect(audit.changes).toMatchObject({
      previous: null,
      next: { active: true },
    });
  });

  it("denies direct access-table and audit writes to runtime and maintenance", async () => {
    const { actor, target } = await users();
    for (const connection of [runtime, maintenance]) {
      await expect(connection`
        INSERT INTO public.administrative_access (user_id, access_level, granted_by)
        VALUES (${target}, 'TECHNICAL', ${actor})`).rejects.toMatchObject({
        code: "42501",
      });
      await expect(connection`
        INSERT INTO private.uc02_audit (actor_kind, actor_user_id, action, changes)
        VALUES ('maintenance', ${actor}, 'access.technical_changed', '{}')`).rejects.toMatchObject(
        { code: "42501" }
      );
    }
  });

  it("blocks anonymous, authenticated and service roles from technical changes", async () => {
    const connection = await admin.reserve();
    try {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await connection.unsafe(`SET ROLE ${role}`);
        try {
          await expect(
            connection.unsafe(
              "SELECT private.set_technical_access(gen_random_uuid(), gen_random_uuid(), true)"
            )
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await connection.unsafe("RESET ROLE");
        }
      }
    } finally {
      connection.release();
    }
  });

  it("rolls back Technical grant when audit insert fails", async () => {
    const { actor, target } = await users();
    const constraint = `audit_probe_${target.replaceAll("-", "")}`;
    await admin.unsafe(`ALTER TABLE private.uc02_audit ADD CONSTRAINT ${constraint}
      CHECK ((changes->>'note') IS DISTINCT FROM 'audit-must-fail') NOT VALID`);
    try {
      await expect(maintenance`
        SELECT private.set_technical_access(${actor}::uuid, ${target}::uuid, true, 'audit-must-fail')`).rejects.toMatchObject(
        { code: "23514" }
      );
      const rows =
        await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${target}`;
      expect(rows).toHaveLength(0);
    } finally {
      await admin.unsafe(
        `ALTER TABLE private.uc02_audit DROP CONSTRAINT ${constraint}`
      );
    }
  });
});
