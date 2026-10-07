import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, runtimeDb, close } from "./helpers";

describe("access lifecycle transactions", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(async () => close(admin, runtime));

  async function fixture() {
    const [tech, board, old, next, other, committee, foreign] = Array.from(
      { length: 7 },
      () => randomUUID()
    );
    await admin`INSERT INTO auth.users (id, email) VALUES
      (${tech}, ${`${tech}@example.test`}), (${board}, ${`${board}@example.test`}),
      (${old}, ${`${old}@example.test`}), (${next}, ${`${next}@example.test`}),
      (${other}, ${`${other}@example.test`})`;
    await admin`INSERT INTO public.committees (id, name, slug) VALUES
      (${committee}, ${`Lifecycle ${committee}`}, ${committee}), (${foreign}, ${`Lifecycle ${foreign}`}, ${foreign})`;
    await admin`INSERT INTO public.administrative_access (user_id, access_level, committee_id, granted_by) VALUES
      (${tech}, 'TECHNICAL', NULL, ${tech}), (${board}, 'BOARD_ADMIN', NULL, ${tech}),
      (${old}, 'COMMITTEE_MANAGER', ${committee}, ${tech})`;
    return { tech, board, old, next, other, committee, foreign };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function replace(
    f: Fixture,
    target = f.next,
    actor = f.tech,
    committee = f.committee
  ) {
    const [row] = await runtime`SELECT private.replace_committee_manager(
      ${actor}::uuid, ${f.old}::uuid, ${target}::uuid, ${committee}::uuid, 'approved replacement') AS result`;
    return row.result.code;
  }
  async function grant(f: Fixture, target: string, committee: string) {
    const [row] = await runtime`SELECT private.change_administrative_access(
      ${f.tech}::uuid, ${target}::uuid, 'COMMITTEE_MANAGER', ${committee}::uuid, 'grant') AS result`;
    return row.result.code;
  }

  it("replaces atomically, retains the identity and original activity, and denies every old scope", async () => {
    const f = await fixture();
    const [created] =
      await runtime`SELECT private.create_event(${f.old}::uuid, ${f.committee}::uuid,
      'Before replacement', 'Historical attribution', now() + interval '7 days', NULL, NULL) AS result`;
    expect(created.result.code).toBe("SUCCESS");
    expect(await replace(f)).toBe("SUCCESS");
    const [scope] = await admin`SELECT
      private.can_access_committee(${f.old}::uuid, ${f.committee}::uuid) AS old_scope,
      private.can_access_committee(${f.next}::uuid, ${f.committee}::uuid) AS new_scope,
      private.can_access_committee(${f.next}::uuid, ${f.foreign}::uuid) AS foreign_scope`;
    expect(scope).toEqual({
      old_scope: false,
      new_scope: true,
      foreign_scope: false,
    });
    const audit =
      await admin`SELECT actor_user_id, committee_id, action, changes FROM private.uc02_audit
      WHERE changes->>'userId' IN (${f.old}, ${f.next}) ORDER BY action`;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      actor_user_id: f.tech,
      committee_id: f.committee,
      action: "manager.assigned",
      changes: {
        userId: f.next,
        replacesUserId: f.old,
        previous: null,
        next: { active: true, committeeId: f.committee },
      },
    });
    expect(audit[1]).toMatchObject({
      action: "manager.revoked",
      changes: {
        userId: f.old,
        replacedByUserId: f.next,
        previous: { active: true },
        next: { active: false },
      },
    });
    expect(audit[0].changes.replacementId).toBe(audit[1].changes.replacementId);
    expect(
      await admin`SELECT id FROM auth.users WHERE id = ${f.old}`
    ).toHaveLength(1);
    const [history] = await admin`SELECT actor_user_id FROM private.uc02_audit
      WHERE event_id = ${created.result.eventId} AND action = 'event.created'`;
    expect(history.actor_user_id).toBe(f.old);
    expect(
      await runtime`SELECT * FROM private.get_admin_event(${f.old}::uuid, ${created.result.eventId}::uuid)`
    ).toHaveLength(0);
    const [denied] =
      await runtime`SELECT private.create_event(${f.old}::uuid, ${f.committee}::uuid,
      'Denied', 'Retained identity', now() + interval '7 days', NULL, NULL) AS result`;
    expect(denied.result.code).toBe("NOT_FOUND");
    await admin.begin(async (q) => {
      await q`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: f.old, role: "authenticated" })}, true)`;
      await q`SET LOCAL ROLE authenticated`;
      expect(await q`SELECT * FROM public.committees`).toHaveLength(0);
      expect(await q`SELECT * FROM public.events`).toHaveLength(0);
      expect(await q`SELECT * FROM public.registrations`).toHaveLength(0);
    });
    await expect(
      admin`DELETE FROM auth.users WHERE id = ${f.old}`
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects unauthorized, already-scoped, elevated, missing and stale replacements without changing either side", async () => {
    const f = await fixture();
    expect(await replace(f, f.next, f.board)).toBe("FORBIDDEN");
    expect(await replace(f, f.next, f.other)).toBe("FORBIDDEN");
    expect(await replace(f, f.old)).toBe("VALIDATION_ERROR");
    expect(await replace(f, randomUUID())).toBe("USER_NOT_FOUND");
    expect(await replace(f, f.board)).toBe("CONFLICT");
    expect(await replace(f, f.next, f.tech, f.foreign)).toBe("ACCESS_CHANGED");
    expect(await grant(f, f.next, f.foreign)).toBe("SUCCESS");
    expect(await replace(f)).toBe("SECOND_MANAGER_SCOPE");
    const [old] =
      await admin`SELECT revoked_at FROM public.administrative_access WHERE user_id = ${f.old}`;
    expect(old.revoked_at).toBeNull();
    expect(
      await admin`SELECT id FROM private.uc02_audit WHERE changes->>'userId' = ${f.old}`
    ).toHaveLength(0);
  });

  it("serializes two simultaneous scope assignments to one identity", async () => {
    const f = await fixture();
    const codes = await Promise.all([
      grant(f, f.next, f.committee),
      grant(f, f.next, f.foreign),
    ]);
    expect(codes.sort()).toEqual(["SECOND_MANAGER_SCOPE", "SUCCESS"]);
    expect(
      await admin`SELECT * FROM public.administrative_access WHERE user_id = ${f.next} AND revoked_at IS NULL`
    ).toHaveLength(1);
    // Preserves the existing policy: another person may manage the same committee.
    expect(await grant(f, f.other, f.committee)).toBe("SUCCESS");
  });

  it("serializes ordinary and Technical grants instead of overwriting an active role", async () => {
    const f = await fixture();
    const codes = await Promise.all([
      grant(f, f.next, f.committee),
      runtime`SELECT private.change_technical_access(${f.tech}::uuid, ${f.next}::uuid, 'grant') AS result`.then(
        (rows) => rows[0].result.code as string
      ),
    ]);
    expect(codes.filter((code) => code === "SUCCESS")).toHaveLength(1);
    expect(["CONFLICT", "FORBIDDEN"]).toContain(
      codes.find((code) => code !== "SUCCESS")
    );
    expect(
      await admin`SELECT * FROM private.uc02_audit WHERE changes->>'userId' = ${f.next}`
    ).toHaveLength(1);
  });

  it("allows only one competing replacement and never leaves both replacements active", async () => {
    const f = await fixture();
    expect(
      (await Promise.all([replace(f), replace(f, f.other)])).sort()
    ).toEqual(["ACCESS_ALREADY_REVOKED", "SUCCESS"]);
    expect(
      await admin`SELECT * FROM public.administrative_access
      WHERE user_id IN (${f.next}, ${f.other}) AND revoked_at IS NULL`
    ).toHaveLength(1);
  });

  it("does not replace a new manager concurrently assigned elsewhere", async () => {
    const f = await fixture();
    const codes = await Promise.all([replace(f), grant(f, f.next, f.foreign)]);
    expect(codes.sort()).toEqual(["SECOND_MANAGER_SCOPE", "SUCCESS"]);
    const [next] =
      await admin`SELECT committee_id FROM public.administrative_access WHERE user_id = ${f.next}`;
    const [old] =
      await admin`SELECT revoked_at FROM public.administrative_access WHERE user_id = ${f.old}`;
    expect(old.revoked_at === null).toBe(next.committee_id === f.foreign);
  });

  it("rolls both sides and their audit back when the audit insert fails", async () => {
    const f = await fixture();
    await admin.unsafe(`CREATE FUNCTION private.test_replacement_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.changes->>'userId' = '${f.next}' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_replacement_audit_failure BEFORE INSERT ON private.uc02_audit
        FOR EACH ROW EXECUTE FUNCTION private.test_replacement_audit_failure();`);
    try {
      await expect(replace(f)).rejects.toMatchObject({ code: "P0001" });
      const [old] =
        await admin`SELECT revoked_at FROM public.administrative_access WHERE user_id = ${f.old}`;
      expect(old.revoked_at).toBeNull();
      expect(
        await admin`SELECT * FROM public.administrative_access WHERE user_id = ${f.next}`
      ).toHaveLength(0);
      expect(
        await admin`SELECT * FROM private.uc02_audit WHERE changes->>'userId' IN (${f.old}, ${f.next})`
      ).toHaveLength(0);
    } finally {
      await admin`DROP TRIGGER test_replacement_audit_failure ON private.uc02_audit`;
      await admin`DROP FUNCTION private.test_replacement_audit_failure()`;
    }
  });

  it("denies a privileged action waiting behind a committed revocation", async () => {
    const f = await fixture();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pidReady = Promise.withResolvers<number>();
    const revoke = runtime.begin(async (q) => {
      const [row] =
        await q`SELECT private.change_administrative_access(${f.tech}::uuid, ${f.old}::uuid,
        'COMMITTEE_MANAGER', ${f.committee}::uuid, 'revoke') AS result`;
      expect(row.result.code).toBe("SUCCESS");
      locked.resolve();
      await release.promise;
    });
    const revoking = Promise.resolve(revoke);
    await locked.promise;
    const action = runtime.begin(async (q) => {
      const [row] = await q`SELECT pg_backend_pid() AS pid`;
      pidReady.resolve(row.pid);
      const [created] =
        await q`SELECT private.create_event(${f.old}::uuid, ${f.committee}::uuid,
        'Must be denied', 'Revoked while waiting', now() + interval '7 days', NULL, NULL) AS result`;
      return created.result.code;
    });
    const acting = Promise.resolve(action);
    const pid = await pidReady.promise;
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const [row] =
          await admin`SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS blocked`;
        blocked = row.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      release.resolve();
    }
    await revoking;
    expect(await acting).toBe("NOT_FOUND");
    const [again] =
      await runtime`SELECT private.change_administrative_access(${f.tech}::uuid, ${f.old}::uuid,
      'COMMITTEE_MANAGER', ${f.committee}::uuid, 'revoke') AS result`;
    expect(again.result.code).toBe("ACCESS_ALREADY_REVOKED");
  });

  it("grants only the restricted runtime routine and keeps direct DML denied", async () => {
    const f = await fixture();
    for (const role of ["anon", "authenticated"]) {
      await expect(
        admin.begin(async (q) => {
          await q.unsafe(`SET LOCAL ROLE ${role}`);
          await q`SELECT private.replace_committee_manager(${f.tech}::uuid, ${f.old}::uuid, ${f.next}::uuid, ${f.committee}::uuid)`;
        })
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      runtime`UPDATE public.administrative_access SET revoked_at = NULL WHERE user_id = ${f.old}`
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("preserves one Technical owner under concurrent self-revocations", async () => {
    const f = await fixture();
    await runtime`SELECT private.change_technical_access(${f.tech}::uuid, ${f.next}::uuid, 'grant')`;
    const others =
      await admin`UPDATE public.administrative_access SET revoked_at = now()
      WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL AND user_id NOT IN (${f.tech}, ${f.next}) RETURNING user_id`;
    try {
      const codes = await Promise.all(
        [f.tech, f.next].map((id) =>
          runtime`SELECT private.change_technical_access(${id}::uuid, ${id}::uuid, 'revoke') AS result`.then(
            (rows) => rows[0].result.code as string
          )
        )
      );
      expect(codes.sort()).toEqual(["LAST_TECHNICAL_ADMIN", "SUCCESS"]);
      expect(
        await admin`SELECT * FROM public.administrative_access WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL`
      ).toHaveLength(1);
    } finally {
      for (const row of others)
        await admin`UPDATE public.administrative_access SET revoked_at = NULL WHERE user_id = ${row.user_id}`;
    }
  });
});
