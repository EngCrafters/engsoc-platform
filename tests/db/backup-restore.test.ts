import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { adminDb, close, createFixture } from "./helpers";

const runFile = promisify(execFile);
const container = process.env.UC02_TEST_CONTAINER_NAME;

describe.skipIf(!container)("M8 isolated backup and restore", () => {
  const admin = adminDb();

  it("recovers the current schema, routines, grants, RLS, and nullable member data", async () => {
    if (!container?.startsWith("engsoc-uc02-test-")) {
      throw new Error(
        "Restore rehearsal requires the disposable test container"
      );
    }
    const fixture = await createFixture(admin, { status: "published" });
    const registrationId = randomUUID();
    await admin`
      INSERT INTO public.registrations
        (id, event_id, attendee_name, attendee_email, status, member_id)
      VALUES
        (${registrationId}, ${fixture.eventId}, 'Restore fixture',
         ${`restore-${registrationId}@example.test`}, 'confirmed', NULL)
    `;
    const dump = `/tmp/uc02-${randomUUID()}.dump`;
    const database = `uc02_restore_${randomUUID().replaceAll("-", "")}`;
    const execute = async (...args: string[]) => {
      await runFile("docker", ["exec", container, ...args], {
        windowsHide: true,
      });
    };
    try {
      await execute(
        "pg_dump",
        "-U",
        "postgres",
        "-Fc",
        "-d",
        "uc02_test",
        "-f",
        dump
      );
      await execute("createdb", "-U", "postgres", database);
      await execute(
        "pg_restore",
        "-U",
        "postgres",
        "--exit-on-error",
        "-d",
        database,
        dump
      );

      const restoreUrl = new URL(process.env.TEST_DATABASE_URL!);
      restoreUrl.pathname = `/${database}`;
      const restored = postgres(restoreUrl.toString(), {
        max: 1,
        prepare: false,
      });
      try {
        const [row] = await restored<
          { member_id: string | null }[]
        >`SELECT member_id FROM public.registrations WHERE id = ${registrationId}`;
        expect(row.member_id).toBeNull();
        const [security] = await restored<
          { rls: boolean; force_rls: boolean }[]
        >`SELECT relrowsecurity AS rls, relforcerowsecurity AS force_rls FROM pg_class WHERE oid = 'public.events'::regclass`;
        expect(security).toEqual({ rls: true, force_rls: true });
        const [routine] = await restored<
          { owner: string; runtime_execute: boolean; anon_execute: boolean }[]
        >`
          SELECT pg_get_userbyid(p.proowner) AS owner,
            has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime_execute,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
          FROM pg_proc p
          WHERE p.oid = 'private.count_admin_events(uuid,uuid)'::regprocedure
        `;
        expect(routine).toEqual({
          owner: "uc02_routine_owner",
          runtime_execute: true,
          anon_execute: false,
        });
        const [audit] = await restored<
          { count: number }[]
        >`SELECT count(*)::integer AS count FROM private.uc02_audit`;
        expect(audit.count).toBeGreaterThanOrEqual(0);
      } finally {
        await restored.end();
      }
    } finally {
      await execute("dropdb", "-U", "postgres", "--if-exists", database).catch(
        () => undefined
      );
      await execute("rm", "-f", dump).catch(() => undefined);
      await close(admin);
    }
  }, 60_000);
});
