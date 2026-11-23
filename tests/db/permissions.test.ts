import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { adminDb, close, runtimeDb } from "./helpers";
import { PERMISSION_INFO, PERMISSION_KEYS } from "../../lib/auth/permissions";
import { LEVEL_PERMISSIONS } from "../support/manager-fixture";

// Configurable committee and team permissions (ADR 0027, migration 0035), under the real
// restricted roles: app_runtime calls the routines exactly as Core does; the admin connection only
// arranges fixtures and inspects the result.
describe("configurable permissions (0035, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(async () => {
    await admin`UPDATE private.verification_settings SET document_retention_days = NULL,
      squ_submissions_per_30_days = 3, leadership_requests_per_30_days = 5, max_active_appointments_per_member = NULL`;
    await close(admin, runtime);
  });

  const tag = () => randomBytes(4).toString("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Result = Record<string, any>;
  async function call(fn: string, values: unknown[], db: Sql = runtime) {
    const rows = await db.unsafe(
      `SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return rows[0].result as Result;
  }
  const has = async (
    actor: string,
    key: string,
    committee: string | null = null
  ) =>
    (
      await admin`SELECT private.has_permission(${actor}::uuid, ${key}, ${committee}::uuid) AS ok`
    )[0].ok as boolean;
  async function user() {
    const id = randomUUID();
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${`p.${tag()}@example.org`},now())`;
    return id;
  }
  async function withAccess(
    level: "TECHNICAL" | "BOARD_ADMIN" | "COMMITTEE_MANAGER",
    committeeId: string | null = null
  ) {
    const id = await user();
    await admin`INSERT INTO public.administrative_access(user_id,access_level,committee_id,granted_by)
      VALUES(${id},${level},${committeeId},${id})`;
    return id;
  }
  async function member() {
    const id = await user();
    await admin`INSERT INTO public.members(id,full_name,email,major,category)
      VALUES(${id},${`Synthetic ${tag()}`},${`m.${tag()}@example.org`},'civil','industry_professional')`;
    return id;
  }
  async function committee() {
    const id = randomUUID();
    const slug = `pm-${tag()}`;
    await admin`INSERT INTO public.committees(id,name,slug) VALUES(${id},${`PM ${slug}`},${slug})`;
    return id;
  }
  const people: Record<"technical" | "board" | "affairs", string> = {} as never;
  beforeAll(async () => {
    const [affairs] =
      await admin`SELECT id FROM public.committees WHERE slug = 'society-affairs'`;
    people.technical = await withAccess("TECHNICAL");
    people.board = await withAccess("BOARD_ADMIN");
    people.affairs = await withAccess("COMMITTEE_MANAGER", affairs.id);
  });
  async function team(committeeId: string) {
    const result = await call("admin_create_team", [
      people.board,
      committeeId,
      `Team ${tag()}`,
      null,
      null,
      null,
    ]);
    expect(result.code).toBe("SUCCESS");
    return result.id as string;
  }
  const appoint = async (
    m: string,
    c: string,
    t: string | null,
    position = "chief"
  ) => {
    const result = await call("assign_leadership", [
      people.board,
      m,
      c,
      t,
      position,
      null,
    ]);
    expect(result.code).toBe("SUCCESS");
    return result.appointmentId as string;
  };
  const grant = async (
    kind: "committee" | "team",
    id: string,
    permissions: { key: string; scope: "all" | "own" }[],
    actor = people.board,
    confirmed = true
  ) => {
    const previous =
      (
        await call("get_permission_group", [
          actor,
          kind === "committee" ? id : null,
          kind === "team" ? id : null,
        ])
      ).permissions ?? [];
    return call("set_group_permissions", [
      actor,
      kind === "committee" ? id : null,
      kind === "team" ? id : null,
      permissions,
      previous,
      confirmed,
      null,
    ]);
  };
  const event = async (committeeId: string) => {
    const id = randomUUID();
    await admin`INSERT INTO public.events(id,title,description,event_date,committee_id)
      VALUES(${id},${`Event ${tag()}`},'Synthetic.',now() + interval '10 days',${committeeId})`;
    return id;
  };
  const sees = async (actor: string, eventId: string) =>
    (
      await runtime`SELECT * FROM private.get_admin_event(${actor}::uuid, ${eventId}::uuid)`
    ).length === 1;

  it("keeps the TypeScript catalog and the level mapping identical to the database", async () => {
    const catalog =
      await admin`SELECT key, label_en FROM private.permission_catalog ORDER BY sort_order`;
    expect(catalog.map((r) => r.key)).toEqual([...PERMISSION_KEYS]);
    for (const row of catalog)
      expect(
        PERMISSION_INFO[row.key as keyof typeof PERMISSION_INFO].label
      ).toBe(row.label_en);
    for (const level of [
      "TECHNICAL",
      "BOARD_ADMIN",
      "COMMITTEE_MANAGER",
    ] as const) {
      const rows =
        await admin`SELECT permission FROM private.access_level_permissions
        WHERE access_level = ${level} ORDER BY permission`;
      expect(rows.map((r) => r.permission)).toEqual(
        [...LEVEL_PERMISSIONS[level]].sort()
      );
    }
  });

  it("gives Chiefs and Assistant Chiefs their own group's permissions, and never through requests or membership", async () => {
    const c = await committee();
    const chief = await member();
    const assistant = await member();
    const requester = await member();
    const plain = await member();
    expect(
      (
        await grant("committee", c, [
          { key: "events.view", scope: "own" },
          { key: "email.send", scope: "all" },
        ])
      ).code
    ).toBe("SUCCESS");
    await appoint(chief, c, null, "chief");
    await appoint(assistant, c, null, "assistant_chief");
    expect(
      (await call("request_leadership", [requester, c, null, "chief"])).code
    ).toBe("SUCCESS");
    for (const leader of [chief, assistant]) {
      expect(await has(leader, "email.send")).toBe(true);
      expect(await has(leader, "events.view", c)).toBe(true);
      expect(await has(leader, "events.view")).toBe(false); // own committee, not society-wide
    }
    for (const nobody of [requester, plain]) {
      expect(await has(nobody, "email.send")).toBe(false);
      expect(
        (await call("get_dashboard_access", [nobody])).permissions
      ).toEqual({});
    }
    const own = await call("get_own_leadership", [chief]);
    expect(own.dashboardAccess).toBe(true);
    expect(own.appointments[0].grantsAccess).toBe(true);
  });

  it("keeps committee and team permissions independent", async () => {
    const c = await committee();
    const t = await team(c);
    const committeeChief = await member();
    const teamChief = await member();
    await grant("committee", c, [{ key: "events.view", scope: "own" }]);
    await grant("team", t, [{ key: "email.send", scope: "all" }]);
    await appoint(committeeChief, c, null);
    await appoint(teamChief, c, t);
    expect(await has(committeeChief, "events.view", c)).toBe(true);
    expect(await has(committeeChief, "email.send")).toBe(false);
    expect(await has(teamChief, "email.send")).toBe(true);
    expect(await has(teamChief, "events.view", c)).toBe(false); // no inheritance from the committee
  });

  it("combines several appointments without widening any scope", async () => {
    const a = await committee();
    const b = await committee();
    const tb = await team(b);
    const leader = await member();
    await grant("committee", a, [{ key: "events.edit", scope: "own" }]);
    await grant("team", tb, [{ key: "registrations.view", scope: "own" }]);
    await appoint(leader, a, null);
    await appoint(leader, b, tb, "assistant_chief");
    expect(await has(leader, "events.edit", a)).toBe(true);
    expect(await has(leader, "events.edit", b)).toBe(false);
    expect(await has(leader, "registrations.view", b)).toBe(true);
    expect(await has(leader, "registrations.view", a)).toBe(false);
    const access = await call("get_dashboard_access", [leader]);
    expect(access.permissions["events.edit"]).toEqual([a]);
    expect(access.permissions["registrations.view"]).toEqual([b]);
  });

  it("enforces scoped permissions in the routines, not only in the interface", async () => {
    const a = await committee();
    const b = await committee();
    const leader = await member();
    await grant("committee", a, [
      { key: "events.view", scope: "own" },
      { key: "events.edit", scope: "own" },
    ]);
    await appoint(leader, a, null);
    const inA = await event(a);
    const inB = await event(b);
    expect(await sees(leader, inA)).toBe(true);
    expect(await sees(leader, inB)).toBe(false);
    // Direct calls without the permission are refused, whatever the interface shows.
    expect(
      (await call("admin_list_members", [leader, "", "all", 0])).code
    ).toBe("FORBIDDEN");
    expect((await call("list_permission_groups", [leader])).code).toBe(
      "FORBIDDEN"
    );
    expect(
      (await call("set_verification_settings", [leader, 3, null, 5, null])).code
    ).toBe("FORBIDDEN");
    expect((await call("email_filter_options", [leader])).code).toBe(
      "FORBIDDEN"
    );
    // create_event answers NOT_FOUND for a committee outside the actor's scope (it never reveals it).
    expect(
      (
        await call("create_event", [
          leader,
          b,
          "Not mine",
          "x",
          new Date(Date.now() + 864e5),
          null,
          null,
        ])
      ).code
    ).toBe("NOT_FOUND");
  });

  it("makes full access work across every area, beyond Board Administration", async () => {
    const f = await committee();
    const other = await committee();
    const leader = await member();
    const all = PERMISSION_KEYS.map((key) => ({ key, scope: "all" as const }));
    expect((await grant("committee", f, all, people.board, false)).code).toBe(
      "CONFIRMATION_REQUIRED"
    );
    expect((await grant("committee", f, all)).code).toBe("SUCCESS");
    await appoint(leader, f, null);
    const access = await call("get_dashboard_access", [leader]);
    for (const key of PERMISSION_KEYS)
      expect(access.permissions[key], key).toBe("all");
    expect(await sees(leader, await event(other))).toBe(true);
    expect(
      (await call("admin_list_members", [leader, "", "all", 0])).code
    ).toBe("SUCCESS");
    expect((await call("admin_overview", [leader])).code).toBe("SUCCESS");
    expect((await call("list_permission_groups", [leader])).code).toBe(
      "SUCCESS"
    );
    expect(
      (await call("project_read", [leader, null, true, "all", "", 0])).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("list_squ_verifications", [
          leader,
          "pending",
          "",
          null,
          null,
          0,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("list_leadership_requests", [
          leader,
          "all",
          null,
          null,
          "",
          null,
          null,
          0,
        ])
      ).code
    ).toBe("SUCCESS");
    expect((await call("email_filter_options", [leader])).code).toBe("SUCCESS");
    expect((await call("get_membership_review_overview", [leader])).code).toBe(
      "SUCCESS"
    );
    expect(
      (
        await runtime`SELECT count(*)::int AS n FROM private.list_administrative_access(${leader}::uuid)`
      )[0].n
    ).toBeGreaterThan(0);
    // Account administration and system settings: grants Technical access (Board cannot) and sets the policy.
    const target = await user();
    expect(
      (
        await call("change_technical_access", [
          leader,
          target,
          "grant",
          "full access test",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("change_technical_access", [
          leader,
          target,
          "revoke",
          "full access test",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("change_technical_access", [
          people.board,
          target,
          "grant",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (await call("set_membership_approval_policy", [leader, "two_step"])).code
    ).toBe("SUCCESS");
    expect(
      (await call("set_membership_approval_policy", [leader, "unset"])).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("admin_create_committee", [
          leader,
          `Full ${tag()}`,
          `full-${tag()}`,
          null,
        ])
      ).code
    ).toBe("SUCCESS");
  });

  it("lets a group given permission management manage other groups, but never its own", async () => {
    const p = await committee();
    const other = await committee();
    const manager = await member();
    expect(
      (
        await grant(
          "committee",
          p,
          [{ key: "permissions.manage", scope: "all" }],
          people.board,
          false
        )
      ).code
    ).toBe("CONFIRMATION_REQUIRED");
    expect(
      (
        await grant("committee", p, [
          { key: "permissions.manage", scope: "all" },
        ])
      ).code
    ).toBe("SUCCESS");
    await appoint(manager, p, null);
    const full = PERMISSION_KEYS.map((key) => ({ key, scope: "all" as const }));
    expect((await grant("committee", other, full, manager)).code).toBe(
      "SUCCESS"
    );
    expect((await grant("committee", p, full, manager)).code).toBe(
      "SELF_CHANGE"
    );
    // A stale editor is refused.
    expect(
      (
        await call("set_group_permissions", [
          manager,
          other,
          null,
          [],
          [],
          true,
          null,
        ])
      ).code
    ).toBe("STALE_REVISION");
    // Every change is audited with the actor, the group, before and after.
    const history = (
      await call("get_permission_group", [people.board, other, null])
    ).history;
    expect(history[0]).toMatchObject({ next: expect.any(Array), previous: [] });
    expect(history[0].next).toHaveLength(PERMISSION_KEYS.length);
    const [audit] =
      await admin`SELECT actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'permissions.changed' AND changes ->> 'committeeId' = ${other} ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit.actor_user_id).toBe(manager);
    expect(audit.changes).toMatchObject({
      groupKind: "committee",
      fullAccess: true,
    });
  });

  it("takes revocations and changes into account on the next call", async () => {
    const c = await committee();
    const t = await team(c);
    const leader = await member();
    const teamLeader = await member();
    await grant("committee", c, [{ key: "email.send", scope: "all" }]);
    await grant("team", t, [{ key: "email.send", scope: "all" }]);
    const appointment = await appoint(leader, c, null);
    await appoint(teamLeader, c, t);
    expect(await has(leader, "email.send")).toBe(true);
    // Removing the permission from the group.
    await grant("committee", c, []);
    expect(await has(leader, "email.send")).toBe(false);
    await grant("committee", c, [{ key: "email.send", scope: "all" }]);
    // Ending the appointment.
    const [{ revision }] =
      await admin`SELECT revision FROM private.leadership_appointments WHERE id = ${appointment}`;
    expect(
      (
        await call("revoke_leadership_appointment", [
          people.board,
          appointment,
          revision,
          "Term ended",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(await has(leader, "email.send")).toBe(false);
    // A team that is not active grants nothing.
    expect(await has(teamLeader, "email.send")).toBe(true);
    expect(
      (await call("admin_set_team_status", [people.board, t, "inactive"])).code
    ).toBe("SUCCESS");
    expect(await has(teamLeader, "email.send")).toBe(false);
  });

  it("refuses to remove the last account that can recover administration", async () => {
    const r = await committee();
    const keeper = await member();
    const all = PERMISSION_KEYS.map((key) => ({ key, scope: "all" as const }));
    await grant("committee", r, all);
    const appointment = await appoint(keeper, r, null);
    const suspended =
      await admin`UPDATE public.administrative_access SET revoked_at = now(), revoked_by = user_id
      WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL RETURNING user_id`;
    const fullGroups =
      await admin`DELETE FROM private.group_permissions WHERE permission = 'accounts.admin_levels'
      AND committee_id IS DISTINCT FROM ${r}::uuid RETURNING *`;
    try {
      expect(
        (await admin`SELECT private.recovery_account_count() AS n`)[0].n
      ).toBe(1);
      expect((await grant("committee", r, [])).code).toBe(
        "LAST_RECOVERY_ACCOUNT"
      );
      const [{ revision }] =
        await admin`SELECT revision FROM private.leadership_appointments WHERE id = ${appointment}`;
      await expect(
        call("revoke_leadership_appointment", [
          people.board,
          appointment,
          revision,
          "End",
          null,
        ])
      ).rejects.toThrow("LAST_RECOVERY_ACCOUNT");
      expect(await has(keeper, "permissions.manage")).toBe(true);
    } finally {
      for (const row of fullGroups)
        await admin`INSERT INTO private.group_permissions ${admin(row as Record<string, unknown>)}`;
      for (const { user_id } of suspended)
        await admin`UPDATE public.administrative_access SET revoked_at = NULL, revoked_by = NULL WHERE user_id = ${user_id}`;
    }
  });

  it("lets Society Affairs edit the verification settings through its configuration, with retention confirmed", async () => {
    expect(
      (
        await call("set_verification_settings", [
          people.affairs,
          4,
          null,
          6,
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("set_position_limit", [
          people.affairs,
          "chief",
          "committee",
          2,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("set_position_limit", [
          people.affairs,
          "chief",
          "committee",
          1,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("set_leadership_requests_open", [people.affairs, true])).code
    ).toBe("UNCHANGED");
    // Stored evidence decided 40 days ago becomes eligible under a 30-day period: confirm first.
    const m = await member();
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      randomBytes(32),
    ]);
    const submitted = await call("submit_squ_verification", [
      m,
      String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
      "image/jpeg",
      createHash("sha256").update(bytes).digest("hex"),
      bytes.length,
      bytes,
      null,
      null,
    ]);
    expect(submitted.code).toBe("SUCCESS");
    expect(
      (
        await call("decide_squ_verification", [
          people.board,
          submitted.requestId,
          1,
          "reject",
          "Unreadable",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    await admin`UPDATE private.squ_verification_requests SET submitted_at = now() - interval '45 days',
      decided_at = now() - interval '40 days' WHERE id = ${submitted.requestId}`;
    expect(
      (await call("preview_retention_impact", [people.affairs, 30])).eligible
    ).toBeGreaterThanOrEqual(1);
    const unconfirmed = await call("set_verification_settings", [
      people.affairs,
      4,
      30,
      6,
      null,
      false,
    ]);
    expect(unconfirmed.code).toBe("RETENTION_CONFIRMATION_REQUIRED");
    expect(unconfirmed.eligible).toBeGreaterThanOrEqual(1);
    expect(
      (
        await admin`SELECT document_retention_days FROM private.verification_settings`
      )[0].document_retention_days
    ).toBeNull();
    expect(
      (
        await call("set_verification_settings", [
          people.affairs,
          4,
          30,
          6,
          null,
          true,
        ])
      ).code
    ).toBe("SUCCESS");
    // Saving deleted nothing.
    expect(
      (
        await admin`SELECT count(*)::int AS n FROM private.squ_verification_documents WHERE request_id = ${submitted.requestId}`
      )[0].n
    ).toBe(1);
    const [audit] =
      await admin`SELECT actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'verification.settings_changed' ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit.actor_user_id).toBe(people.affairs);
    expect(audit.changes.next.documentRetentionDays).toBe(30);
    // A Committee Manager of another committee cannot.
    const outsider = await withAccess("COMMITTEE_MANAGER", await committee());
    expect(
      (await call("set_verification_settings", [outsider, 3, null, 5, null]))
        .code
    ).toBe("FORBIDDEN");
  });

  it("keeps a committee-level position limit separate from the team limit", async () => {
    const c = await committee();
    const t = await team(c);
    const [a, b, x, y] = [
      await member(),
      await member(),
      await member(),
      await member(),
    ];
    await appoint(a, c, null);
    expect(
      (
        await call("assign_leadership", [
          people.board,
          b,
          c,
          null,
          "chief",
          null,
        ])
      ).code
    ).toBe("POSITION_FULL");
    expect(
      (
        await call("set_position_limit", [
          people.board,
          "chief",
          "committee",
          2,
        ])
      ).code
    ).toBe("SUCCESS");
    try {
      expect(
        (
          await call("assign_leadership", [
            people.board,
            b,
            c,
            null,
            "chief",
            null,
          ])
        ).code
      ).toBe("SUCCESS");
      await appoint(x, c, t);
      expect(
        (
          await call("assign_leadership", [
            people.board,
            y,
            c,
            t,
            "chief",
            null,
          ])
        ).code
      ).toBe("POSITION_FULL");
    } finally {
      await call("set_position_limit", [people.board, "chief", "committee", 1]);
    }
  });
});
