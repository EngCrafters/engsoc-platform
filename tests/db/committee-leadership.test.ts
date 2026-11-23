import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { adminDb, close, runtimeDb } from "./helpers";

// Committee-level leadership and the request switch (ADR 0026, migration 0034), under the real
// restricted roles: a request or appointment belongs to a committee, and to a team only for team
// leadership.
describe("committee leadership (0034, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const runtime2 = runtimeDb();
  afterAll(async () => {
    await admin`UPDATE private.verification_settings SET leadership_requests_open = true,
      max_active_appointments_per_member = NULL, leadership_requests_per_30_days = 5`;
    await close(admin, runtime, runtime2);
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
  async function user() {
    const id = randomUUID();
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${`u.${tag()}@example.org`},now())`;
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
  async function member(id?: string) {
    const email = `m.${tag()}@example.org`;
    const memberId = id ?? (await user());
    await admin`INSERT INTO public.members(id,full_name,email,major,category)
      VALUES(${memberId},${`Synthetic ${tag()}`},${email},'civil','industry_professional')`;
    return memberId;
  }
  async function committee() {
    const id = randomUUID();
    const slug = `cl-${tag()}`;
    await admin`INSERT INTO public.committees(id,name,slug) VALUES(${id},${`CL ${slug}`},${slug})`;
    return id;
  }
  const people: Record<"technical" | "board" | "affairs" | "manager", string> =
    {} as never;
  beforeAll(async () => {
    const [affairs] =
      await admin`SELECT id FROM public.committees WHERE slug = 'society-affairs'`;
    people.technical = await withAccess("TECHNICAL");
    people.board = await withAccess("BOARD_ADMIN");
    people.affairs = await withAccess("COMMITTEE_MANAGER", affairs.id);
    people.manager = await withAccess("COMMITTEE_MANAGER", await committee());
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
  const request = (
    m: string,
    c: string,
    t: string | null,
    position = "chief",
    db: Sql = runtime
  ) => call("request_leadership", [m, c, t, position], db);
  const decide = (
    actor: string,
    id: string,
    revision: number,
    decision: "approve" | "reject",
    reason: string | null = null,
    db: Sql = runtime
  ) =>
    call(
      "decide_leadership_request",
      [actor, id, revision, decision, reason, null],
      db
    );

  it("lets a member request committee-level leadership in a committee with no teams", async () => {
    const c = await committee();
    const m = await member();
    const options = await call("get_leadership_options", [m]);
    expect(options.requestsOpen).toBe(true);
    expect(options.committees.find((x: Result) => x.id === c)).toMatchObject({
      teams: [],
    });
    const sent = await request(m, c, null);
    expect(sent.code).toBe("SUCCESS");
    expect(sent.requests[0]).toMatchObject({
      status: "pending",
      level: "committee",
      team: null,
      committee: { id: c },
      position: { id: "chief" },
    });
    expect((await request(m, c, null, "assistant_chief")).code).toBe(
      "ALREADY_PENDING"
    );
    expect(
      (await decide(people.board, sent.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    const mine = await call("get_own_leadership", [m]);
    expect(mine.appointments[0]).toMatchObject({
      active: true,
      level: "committee",
      team: null,
      committee: { id: c },
    });
    // A title, not dashboard access.
    expect(mine.dashboardAccess).toBe(false);
    const [{ grants }] =
      await admin`SELECT count(*)::int AS grants FROM public.administrative_access WHERE user_id = ${m}`;
    expect(grants).toBe(0);
    const managed = await call("admin_list_committee_teams", [people.board, c]);
    expect(managed.committeeLeaders).toEqual([
      expect.objectContaining({
        memberId: m,
        position: expect.objectContaining({ id: "chief" }),
      }),
    ]);
    expect(managed.teams).toEqual([]);
    // No dummy team anywhere: the appointment has its committee and no team.
    const [row] =
      await admin`SELECT team_id, committee_id FROM private.leadership_appointments WHERE member_id = ${m}`;
    expect(row).toEqual({ team_id: null, committee_id: c });
    expect((await request(m, c, null, "assistant_chief")).code).toBe(
      "ALREADY_APPOINTED"
    );
  });

  it("keeps committee-level and team-level leadership separate within a committee that has teams", async () => {
    const c = await committee();
    const t = await team(c);
    const [m, m2] = [await member(), await member()];
    const committeeChief = await request(m, c, null, "chief");
    const teamChief = await request(m, c, t, "chief");
    expect([committeeChief.code, teamChief.code]).toEqual([
      "SUCCESS",
      "SUCCESS",
    ]);
    const rival = await request(m2, c, null, "chief");
    expect(rival.code).toBe("SUCCESS");
    const options = await call("get_leadership_options", [m]);
    expect(options.committees.find((x: Result) => x.id === c).teams).toEqual([
      expect.objectContaining({ id: t }),
    ]);
    const listed = await call("list_leadership_requests", [
      people.affairs,
      "pending",
      c,
      null,
      null,
      null,
      null,
      0,
    ]);
    expect(listed.items.map((i: Result) => i.level).sort()).toEqual([
      "committee",
      "committee",
      "team",
    ]);
    expect(
      listed.items.find((i: Result) => i.level === "committee").team
    ).toBeNull();
    const detail = await call("get_leadership_request", [
      people.affairs,
      committeeChief.requestId,
    ]);
    expect(detail).toMatchObject({
      level: "committee",
      team: null,
      stale: false,
      holders: [],
      maxHolders: 1,
    });

    // One Chief per scope: the committee and the team are separate scopes.
    expect(
      (await decide(people.affairs, committeeChief.requestId, 1, "approve"))
        .code
    ).toBe("SUCCESS");
    expect(
      (await decide(people.affairs, rival.requestId, 1, "approve")).code
    ).toBe("POSITION_FULL");
    expect(
      (await decide(people.affairs, teamChief.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    // The rival may still lead the team as Assistant Chief, but the team Chief may not also be
    // its Assistant Chief.
    expect(
      (
        await call("assign_leadership", [
          people.board,
          m2,
          c,
          t,
          "assistant_chief",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("assign_leadership", [
          people.board,
          m,
          c,
          t,
          "assistant_chief",
          null,
        ])
      ).code
    ).toBe("ALREADY_APPOINTED");
    const mine = await call("get_own_leadership", [m]);
    expect(
      mine.appointments.map((a: Result) => `${a.level}:${a.position.id}`).sort()
    ).toEqual(["committee:chief", "team:chief"]);
    // The rival's pending committee-level request is still theirs to have rejected.
    expect(
      (
        await decide(
          people.board,
          rival.requestId,
          1,
          "reject",
          "The committee Chief is in place."
        )
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("get_own_leadership", [m2])).requests.find(
        (r: Result) => r.level === "committee"
      )
    ).toMatchObject({
      status: "rejected",
      rejectionReason: "The committee Chief is in place.",
    });
  });

  it("never exceeds one holder of a committee-level position under concurrent approvals, and serializes duplicate requests", async () => {
    const c = await committee();
    const [one, two, three] = [await member(), await member(), await member()];
    const r1 = await request(one, c, null);
    const r2 = await request(two, c, null);
    const outcomes = await Promise.all([
      decide(people.board, r1.requestId, 1, "approve", null, runtime),
      decide(people.affairs, r2.requestId, 1, "approve", null, runtime2),
    ]);
    expect(outcomes.map((o) => o.code).sort()).toEqual([
      "POSITION_FULL",
      "SUCCESS",
    ]);
    const [{ chiefs }] =
      await admin`SELECT count(*)::int AS chiefs FROM private.leadership_appointments
        WHERE committee_id = ${c} AND team_id IS NULL AND position_id = 'chief' AND ended_at IS NULL`;
    expect(chiefs).toBe(1);
    const duplicate = await Promise.all([
      request(three, c, null, "assistant_chief", runtime),
      request(three, c, null, "assistant_chief", runtime2),
    ]);
    expect(duplicate.map((d) => d.code).sort()).toEqual([
      "ALREADY_PENDING",
      "SUCCESS",
    ]);
    // The database itself refuses a second active committee-level position for one member, and a
    // row with both or neither of a team and a committee.
    const [holder] =
      await admin`SELECT member_id FROM private.leadership_appointments WHERE committee_id = ${c} AND ended_at IS NULL`;
    await expect(
      admin`INSERT INTO private.leadership_appointments (member_id, committee_id, position_id, source, appointed_by)
        VALUES (${holder.member_id}, ${c}, 'assistant_chief', 'direct', ${people.board})`
    ).rejects.toThrow(/leadership_appointments_one_per_committee/);
    const t = await team(c);
    await expect(
      admin`INSERT INTO private.leadership_appointments (member_id, team_id, committee_id, position_id, source, appointed_by)
        VALUES (${three}, ${t}, ${c}, 'assistant_chief', 'direct', ${people.board})`
    ).rejects.toThrow(/leadership_appointments_scope/);
    await expect(
      admin`INSERT INTO private.leadership_appointments (member_id, position_id, source, appointed_by)
        VALUES (${three}, 'assistant_chief', 'direct', ${people.board})`
    ).rejects.toThrow(/leadership_appointments_scope/);
  });

  it("closes and reopens new requests without hiding appointments or stopping decisions", async () => {
    const c = await committee();
    const t = await team(c);
    const [m, holder] = [await member(), await member()];
    const pending = await request(m, c, null, "assistant_chief");
    await call("assign_leadership", [
      people.board,
      holder,
      c,
      null,
      "chief",
      null,
    ]);
    // Holders of settings.verification switch requests (ADR 0027: Board, Technical and, through its
    // committee configuration, Society Affairs); a Committee Manager or a member cannot.
    for (const actor of [people.manager, m])
      expect(
        (await call("set_leadership_requests_open", [actor, false])).code
      ).toBe("FORBIDDEN");
    expect(
      (await call("set_leadership_requests_open", [people.board, false])).code
    ).toBe("SUCCESS");
    expect(
      (await call("set_leadership_requests_open", [people.board, false])).code
    ).toBe("UNCHANGED");
    expect((await call("get_leadership_options", [m])).requestsOpen).toBe(
      false
    );
    const closed = await call("get_own_leadership", [holder]);
    expect(closed.requestsOpen).toBe(false);
    expect(closed.appointments).toHaveLength(1);
    expect((await request(holder, c, t, "chief")).code).toBe("REQUESTS_CLOSED");
    expect((await request(m, c, null, "chief")).code).toBe("REQUESTS_CLOSED");
    expect(
      (await call("get_verification_settings", [people.affairs]))
        .leadershipRequestsOpen
    ).toBe(false);
    // Reviewers still decide what is pending.
    expect(
      (await decide(people.affairs, pending.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    expect(
      (await call("set_leadership_requests_open", [people.technical, true]))
        .code
    ).toBe("SUCCESS");
    expect((await request(holder, c, t, "chief")).code).toBe("SUCCESS");
    const audit =
      await admin`SELECT action, actor_user_id FROM private.uc02_audit
        WHERE action IN ('leadership.requests_closed', 'leadership.requests_opened')
          AND actor_user_id IN (${people.board}, ${people.technical}) ORDER BY occurred_at, id`;
    expect(audit.map((a) => a.action)).toEqual([
      "leadership.requests_closed",
      "leadership.requests_opened",
    ]);
  });

  it("appoints, changes and revokes committee leaders directly, never by oneself or by Technical", async () => {
    const c = await committee();
    const m = await member();
    await member(people.board);
    expect(
      (
        await call("assign_leadership", [
          people.technical,
          m,
          c,
          null,
          "assistant_chief",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("assign_leadership", [
          people.board,
          people.board,
          c,
          null,
          "chief",
          null,
        ])
      ).code
    ).toBe("SELF_REVIEW");
    const own = await request(people.board, c, null);
    expect((await decide(people.board, own.requestId, 1, "approve")).code).toBe(
      "SELF_REVIEW"
    );
    const assigned = await call("assign_leadership", [
      people.affairs,
      m,
      c,
      null,
      "assistant_chief",
      "Elected by the committee.",
    ]);
    expect(assigned.code).toBe("SUCCESS");
    const id = assigned.appointmentId as string;
    expect(
      (
        await call("update_leadership_appointment", [
          people.board,
          id,
          1,
          "chief",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("revoke_leadership_appointment", [
          people.board,
          id,
          2,
          "Term ended.",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    const mine = await call("get_own_leadership", [m]);
    expect(mine.appointments[0]).toMatchObject({
      active: false,
      level: "committee",
      endReason: "Term ended.",
      position: { id: "chief" },
    });
    expect((await request(m, c, null, "chief")).code).toBe("SUCCESS");
    const history =
      await admin`SELECT action, committee_id FROM private.uc02_audit
        WHERE changes ->> 'appointmentId' = ${id} ORDER BY occurred_at, id`;
    expect(history.map((h) => h.action)).toEqual([
      "appointment.created",
      "appointment.updated",
      "appointment.revoked",
    ]);
    expect(new Set(history.map((h) => h.committee_id))).toEqual(new Set([c]));
  });

  it("refuses to archive a committee with committee leaders, then closes its committee-level requests", async () => {
    const c = await committee();
    const t = await team(c);
    const [leader, asker, teamAsker] = [
      await member(),
      await member(),
      await member(),
    ];
    await call("assign_leadership", [
      people.board,
      leader,
      c,
      null,
      "chief",
      null,
    ]);
    const pending = await request(asker, c, null, "assistant_chief");
    const pendingTeam = await request(teamAsker, c, t, "chief");
    expect(
      await call("admin_set_committee_archived", [people.board, c, true])
    ).toMatchObject({ code: "BLOCKED", appointments: 1 });
    const [{ id, revision }] =
      await admin`SELECT id, revision FROM private.leadership_appointments WHERE member_id = ${leader}`;
    await call("revoke_leadership_appointment", [
      people.board,
      id,
      revision,
      "Committee retired.",
      null,
    ]);
    expect(
      (await call("admin_set_committee_archived", [people.board, c, true])).code
    ).toBe("SUCCESS");
    const rows =
      await admin`SELECT id, status, cancellation_reason FROM private.leadership_requests
        WHERE id IN (${pending.requestId}, ${pendingTeam.requestId}) ORDER BY id`;
    expect(rows.map((r) => [r.status, r.cancellation_reason])).toEqual([
      ["cancelled", "committee_archived"],
      ["cancelled", "committee_archived"],
    ]);
    expect((await request(asker, c, null)).code).toBe("COMMITTEE_ARCHIVED");
  });

  it("checks the hierarchy for team leadership while committee leadership needs no team", async () => {
    const [a, b] = [await committee(), await committee()];
    const ta = await team(a);
    const m = await member();
    expect((await request(m, b, ta)).code).toBe("HIERARCHY_MISMATCH");
    await call("admin_set_team_status", [people.board, ta, "inactive"]);
    expect((await request(m, a, ta)).code).toBe("TEAM_INACTIVE");
    expect((await request(m, a, null)).code).toBe("SUCCESS");
    expect((await request(m, randomUUID(), null)).code).toBe("NOT_FOUND");
    // The previous Core's team-only routine keeps working.
    const tb = await team(b);
    expect(
      (await call("assign_leadership", [people.board, m, tb, "chief", null]))
        .code
    ).toBe("SUCCESS");
  });
});
