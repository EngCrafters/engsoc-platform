import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { adminDb, close, runtimeDb } from "./helpers";

// The Email Centre (ADR 0028, migration 0036) under the real restricted roles. Nothing is sent:
// the dispatch routines are exercised directly, as Core's worker calls them.
describe("Email Centre (0036, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const runtime2 = runtimeDb();
  afterAll(async () => {
    // Leave no queued work for other suites.
    await admin`UPDATE private.email_campaigns SET status = 'cancelled', cancelled_at = now()
      WHERE status IN ('queued', 'sending')`;
    await admin`UPDATE private.email_deliveries SET status = 'skipped', skip_reason = 'cancelled', lease_until = NULL
      WHERE status IN ('pending', 'sending')`;
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
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${`e.${tag()}@example.org`},now())`;
    return id;
  }
  // Every member this suite creates carries one marker interest-free name prefix, so audiences can
  // be narrowed to the suite's own members with an explicit include list.
  async function member(fields: Record<string, unknown> = {}) {
    const id = await user();
    await admin`INSERT INTO public.members ${admin({
      id,
      full_name: `Email ${tag()}`,
      email: `member.${tag()}@example.org`,
      major: "civil",
      category: "industry_professional",
      ...fields,
    })}`;
    return id;
  }
  async function committee() {
    const id = randomUUID();
    const slug = `ec-${tag()}`;
    await admin`INSERT INTO public.committees(id,name,slug) VALUES(${id},${`EC ${slug}`},${slug})`;
    return id;
  }
  let board = "";
  beforeAll(async () => {
    board = await user();
    await admin`INSERT INTO public.administrative_access(user_id,access_level,granted_by) VALUES(${board},'BOARD_ADMIN',${board})`;
  });
  /** The audience restricted to these members, as a sender would with a filter plus "only these". */
  const preview = async (
    audience: Result,
    actor = board,
    search: string | null = null
  ) => call("email_audience_preview", [actor, audience, search, 0]);
  const ids = async (audience: Result, within: string[]) => {
    // Narrow to the suite's members with a committee roster made for the test.
    const c = await committee();
    for (const id of within)
      await admin`INSERT INTO private.committee_members(committee_id, member_id) VALUES(${c}, ${id})`;
    const result = await preview({
      ...audience,
      committees: [...(audience.committees ?? []), c],
    });
    expect(result.code).toBe("SUCCESS");
    const all: string[] = [];
    for (let offset = 0; offset < result.count; offset += 25) {
      const page = await call("email_audience_preview", [
        board,
        { ...audience, committees: [...(audience.committees ?? []), c] },
        null,
        offset,
      ]);
      all.push(...page.recipients.map((r: Result) => r.id));
    }
    return all.sort();
  };

  it("refuses everyone without the Email Centre permission", async () => {
    const plain = await member();
    const manager = await user();
    await admin`INSERT INTO public.administrative_access(user_id,access_level,committee_id,granted_by)
      VALUES(${manager},'COMMITTEE_MANAGER',${await committee()},${manager})`;
    for (const actor of [plain, manager]) {
      expect((await call("email_filter_options", [actor])).code).toBe(
        "FORBIDDEN"
      );
      expect((await preview({}, actor)).code).toBe("FORBIDDEN");
      expect(
        (
          await call("email_save_campaign", [
            actor,
            null,
            null,
            { language: "en" },
          ])
        ).code
      ).toBe("FORBIDDEN");
    }
  });

  it("lets any holder of the permission reach members across all committees", async () => {
    const c = await committee();
    const t = (
      await call("admin_create_team", [
        board,
        c,
        `T ${tag()}`,
        null,
        null,
        null,
      ])
    ).id;
    const sender = await member();
    await call("set_group_permissions", [
      board,
      null,
      t,
      [{ key: "email.send", scope: "all" }],
      [],
      false,
      null,
    ]);
    expect(
      (await call("assign_leadership", [board, sender, c, t, "chief", null]))
        .code
    ).toBe("SUCCESS");
    const elsewhere = await member();
    const other = await committee();
    await admin`INSERT INTO private.committee_members(committee_id, member_id) VALUES(${other}, ${elsewhere})`;
    const result = await preview({ committees: [other] }, sender);
    expect(result.code).toBe("SUCCESS");
    expect(result.recipients.map((r: Result) => r.id)).toContain(elsewhere);
  });

  it("combines filters (AND across, OR within), applies year only to students, and distinguishes SQU", async () => {
    const studentSqu3 = await member({
      category: "university_student",
      institution_id: "squ",
      year: 3,
      major: "mechanical",
      interests: ["data"],
    });
    const studentSqu4 = await member({
      category: "university_student",
      institution_id: "squ",
      year: 4,
      major: "civil",
      interests: ["robotics"],
    });
    const studentUtas3 = await member({
      category: "university_student",
      institution_id: "utas",
      year: 3,
      major: "civil",
    });
    const professional = await member({
      category: "industry_professional",
      major: "mechanical",
    });
    const graduate = await member({ category: "graduate", status: "graduate" });
    const everyone = [
      studentSqu3,
      studentSqu4,
      studentUtas3,
      professional,
      graduate,
    ];
    expect(await ids({}, everyone)).toEqual(
      [studentSqu3, studentSqu4, studentUtas3, professional].sort()
    );
    expect(await ids({ statuses: ["graduate"] }, everyone)).toEqual([graduate]);
    expect(await ids({ institutions: ["squ"] }, everyone)).toEqual(
      [studentSqu3, studentSqu4].sort()
    );
    expect(await ids({ institutions: ["squ"], years: [3] }, everyone)).toEqual([
      studentSqu3,
    ]);
    expect(await ids({ years: [3, 4] }, everyone)).toEqual(
      [studentSqu3, studentSqu4, studentUtas3].sort()
    );
    expect(await ids({ disciplines: ["mechanical"] }, everyone)).toEqual(
      [studentSqu3, professional].sort()
    );
    expect(await ids({ interests: ["data", "robotics"] }, everyone)).toEqual(
      [studentSqu3, studentSqu4].sort()
    );
    expect(
      await ids(
        {
          categories: ["university_student", "industry_professional"],
          disciplines: ["mechanical"],
        },
        everyone
      )
    ).toEqual([studentSqu3, professional].sort());
    // Self-reported SQU is not verified SQU.
    expect(await ids({ squ: ["verified"] }, everyone)).toEqual([]);
    expect(
      await ids({ squ: ["not_verified"], institutions: ["squ"] }, everyone)
    ).toEqual([studentSqu3, studentSqu4].sort());
  });

  it("matches committees, teams and leadership positions in their scope, with inclusions and exclusions", async () => {
    const c = await committee();
    const t = (
      await call("admin_create_team", [
        board,
        c,
        `T ${tag()}`,
        null,
        null,
        null,
      ])
    ).id;
    const roster = await member();
    const committeeChief = await member();
    const teamChief = await member();
    const elsewhereChief = await member();
    const outsider = await member();
    await admin`INSERT INTO private.committee_members(committee_id, member_id) VALUES(${c}, ${roster})`;
    await call("assign_leadership", [
      board,
      committeeChief,
      c,
      null,
      "chief",
      null,
    ]);
    await call("assign_leadership", [board, teamChief, c, t, "chief", null]);
    await call("assign_leadership", [
      board,
      elsewhereChief,
      await committee(),
      null,
      "chief",
      null,
    ]);
    const names = async (audience: Result) => {
      const result = await preview(audience);
      expect(result.code).toBe("SUCCESS");
      return result.recipients.map((r: Result) => r.id).sort();
    };
    expect(await names({ committees: [c] })).toEqual(
      [roster, committeeChief, teamChief].sort()
    );
    expect(await names({ committees: [c], teams: [t] })).toEqual([teamChief]);
    expect(await names({ committees: [c], leadership: ["chief"] })).toEqual(
      [committeeChief, teamChief].sort()
    );
    expect(
      await names({ committees: [c], include: [outsider], exclude: [roster] })
    ).toEqual([committeeChief, teamChief, outsider].sort());
  });

  it("deduplicates by address and always leaves out unsubscribed and suppressed members", async () => {
    const first = await member({ email: `Same.${tag()}@Example.org` });
    const [{ email }] =
      await admin`SELECT email FROM public.members WHERE id = ${first}`;
    const twin = await member({ email: email.toLowerCase() });
    const unsubscribed = await member();
    const suppressed = await member();
    const fine = await member();
    expect(
      (await call("set_own_email_preferences", [unsubscribed, false])).code
    ).toBe("SUCCESS");
    const [{ email: bad }] =
      await admin`SELECT email FROM public.members WHERE id = ${suppressed}`;
    await admin`INSERT INTO private.email_suppressions(email, reason) VALUES(${bad.toLowerCase()}, 'bounced')`;
    const result = await ids({}, [first, twin, unsubscribed, suppressed, fine]);
    expect(result).toHaveLength(2);
    expect(result).toContain(fine);
    expect(result.some((id) => id === first || id === twin)).toBe(true);
    expect(
      (await call("get_own_email_preferences", [unsubscribed])).announcements
    ).toBe(false);
  });

  it("saves drafts without any provider, guards revisions and validates the audience", async () => {
    const draft = await call("email_save_campaign", [
      board,
      null,
      null,
      { language: "both", subjectEn: "Hello", audience: {} },
    ]);
    expect(draft).toMatchObject({ code: "SUCCESS", revision: 1 });
    expect(
      (
        await call("email_save_campaign", [
          board,
          draft.id,
          1,
          {
            language: "en",
            subjectEn: "Hello {{name}}",
            bodyEn: "Body",
            audience: { categories: ["graduate"] },
          },
        ])
      ).revision
    ).toBe(2);
    expect(
      (
        await call("email_save_campaign", [
          board,
          draft.id,
          1,
          { language: "en" },
        ])
      ).code
    ).toBe("STALE_REVISION");
    expect(
      (
        await call("email_save_campaign", [
          board,
          draft.id,
          2,
          { language: "en", audience: { categories: ["nobody"] } },
        ])
      ).field
    ).toBe("audience");
    expect(
      (
        await call("email_save_campaign", [
          board,
          draft.id,
          2,
          { language: "en", audience: { mystery: [] } },
        ])
      ).field
    ).toBe("audience");
    const got = await call("email_get_campaign", [board, draft.id]);
    expect(got.campaign).toMatchObject({
      status: "draft",
      subjectEn: "Hello {{name}}",
      audience: { categories: ["graduate"] },
    });
    const template = await call("email_save_template", [
      board,
      null,
      null,
      { name: "Welcome", subjectEn: "Hi" },
    ]);
    expect(template.code).toBe("SUCCESS");
    expect(
      (await call("email_list_templates", [board])).templates.map(
        (t: Result) => t.name
      )
    ).toContain("Welcome");
    expect(
      (await call("email_archive_template", [board, template.id])).code
    ).toBe("SUCCESS");
  });

  async function queued(recipients: string[], actor = board) {
    const c = await committee();
    for (const id of recipients)
      await admin`INSERT INTO private.committee_members(committee_id, member_id) VALUES(${c}, ${id})`;
    const draft = await call("email_save_campaign", [
      actor,
      null,
      null,
      {
        language: "en",
        subjectEn: "News",
        bodyEn: "Hello {{name}}",
        audience: { committees: [c] },
      },
    ]);
    expect(
      (
        await call("email_queue_campaign", [
          actor,
          draft.id,
          1,
          recipients.length + 1,
        ])
      ).code
    ).toBe("AUDIENCE_CHANGED");
    const result = await call("email_queue_campaign", [
      actor,
      draft.id,
      1,
      recipients.length,
    ]);
    expect(result).toMatchObject({
      code: "SUCCESS",
      recipients: recipients.length,
    });
    expect(
      (
        await call("email_queue_campaign", [
          actor,
          draft.id,
          2,
          recipients.length,
        ])
      ).code
    ).toBe("ALREADY_QUEUED");
    return draft.id as string;
  }

  it("queues only complete messages with a confirmed, non-empty audience, once", async () => {
    const empty = await call("email_save_campaign", [
      board,
      null,
      null,
      {
        language: "both",
        subjectEn: "x",
        bodyEn: "y",
        audience: { committees: [await committee()] },
      },
    ]);
    expect(
      (await call("email_queue_campaign", [board, empty.id, 1, 0])).code
    ).toBe("CONTENT_INCOMPLETE");
    await call("email_save_campaign", [
      board,
      empty.id,
      1,
      {
        language: "en",
        subjectEn: "x",
        bodyEn: "y",
        audience: { committees: [await committee()] },
      },
    ]);
    expect(
      (await call("email_queue_campaign", [board, empty.id, 2, 0])).code
    ).toBe("EMPTY_AUDIENCE");
    const campaign = await queued([await member(), await member()]);
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM private.email_deliveries WHERE campaign_id = ${campaign}`;
    expect(n).toBe(2);
    const [audit] =
      await admin`SELECT actor_user_id, changes FROM private.uc02_audit WHERE action = 'email.campaign_queued'
      AND changes ->> 'campaignId' = ${campaign}`;
    expect(audit).toMatchObject({
      actor_user_id: board,
      changes: { recipients: 2 },
    });
  });

  it("leases deliveries, records acceptance, retries temporary failures, suppresses invalid addresses, and completes", async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    const campaign = await queued([a, b, c]);
    const claimed = await call("email_claim_deliveries", [10, 60, campaign]);
    expect(claimed.deliveries).toHaveLength(3);
    expect(claimed.deliveries[0]).toMatchObject({
      language: "en",
      subjectEn: "News",
      bodyEn: "Hello {{name}}",
      attempt: 1,
    });
    // A second claim while leased takes nothing.
    expect(
      (await call("email_claim_deliveries", [10, 60, campaign])).deliveries
    ).toHaveLength(0);
    const [d1, d2, d3] = claimed.deliveries.map((d: Result) => d.id);
    expect(
      (
        await call("email_complete_delivery", [
          d1,
          "accepted",
          "provider-1",
          null,
          false,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("email_complete_delivery", [
          d1,
          "accepted",
          "provider-1",
          null,
          false,
        ])
      ).code
    ).toBe("NOT_LEASED");
    expect(
      (
        await call("email_complete_delivery", [
          d2,
          "retry",
          null,
          "Busy",
          false,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("email_complete_delivery", [
          d3,
          "failed",
          null,
          "No such mailbox",
          true,
        ])
      ).code
    ).toBe("SUCCESS");
    const rows =
      await admin`SELECT id, status, attempts, next_attempt_at > now() AS later, last_error FROM private.email_deliveries
      WHERE campaign_id = ${campaign} ORDER BY id`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(d1)).toMatchObject({ status: "accepted" });
    expect(byId.get(d2)).toMatchObject({
      status: "pending",
      attempts: 1,
      later: true,
      last_error: "Busy",
    });
    expect(byId.get(d3)).toMatchObject({
      status: "failed",
      last_error: "No such mailbox",
    });
    const [{ email: invalid }] =
      await admin`SELECT email FROM private.email_deliveries WHERE id = ${d3}`;
    expect(
      (
        await admin`SELECT reason FROM private.email_suppressions WHERE email = ${invalid}`
      )[0].reason
    ).toBe("invalid");
    // Retries end after five attempts.
    for (let attempt = 2; attempt <= 5; attempt++) {
      await admin`UPDATE private.email_deliveries SET next_attempt_at = now() WHERE id = ${d2}`;
      const again = await call("email_claim_deliveries", [10, 60, campaign]);
      expect(again.deliveries.map((d: Result) => d.id)).toEqual([d2]);
      await call("email_complete_delivery", [d2, "retry", null, "Busy", false]);
    }
    expect(
      (
        await admin`SELECT status FROM private.email_deliveries WHERE id = ${d2}`
      )[0].status
    ).toBe("failed");
    const detail = await call("email_get_campaign", [board, campaign]);
    expect(detail.campaign.status).toBe("completed");
    expect(detail.counts).toMatchObject({
      accepted: 1,
      failed: 2,
      delivered: 0,
    });
    // Accepted is not delivered until the provider says so.
    expect(
      (await call("email_record_event", ["provider-1", "delivered", null])).code
    ).toBe("SUCCESS");
    expect(
      (await call("email_get_campaign", [board, campaign])).counts.delivered
    ).toBe(1);
  });

  it("halts a campaign when the sender loses the permission before sending", async () => {
    const c = await committee();
    const sender = await member();
    await call("set_group_permissions", [
      board,
      c,
      null,
      [{ key: "email.send", scope: "all" }],
      [],
      false,
      null,
    ]);
    await call("assign_leadership", [board, sender, c, null, "chief", null]);
    const campaign = await queued([await member(), await member()], sender);
    // The sender's committee loses the permission before the worker runs.
    const previous = (await call("get_permission_group", [board, c, null]))
      .permissions;
    expect(
      (
        await call("set_group_permissions", [
          board,
          c,
          null,
          [],
          previous,
          false,
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("email_claim_deliveries", [10, 60, campaign])).deliveries
    ).toHaveLength(0);
    const detail = await call("email_get_campaign", [board, campaign]);
    expect(detail.campaign).toMatchObject({
      status: "halted",
      haltReason: "SENDER_NOT_AUTHORIZED",
    });
    expect(detail.counts).toMatchObject({
      skipped: 2,
      accepted: 0,
      pending: 0,
    });
    expect(detail.problems.map((p: Result) => p.skipReason)).toEqual([
      "sender_not_authorized",
      "sender_not_authorized",
    ]);
  });

  it("halts the rest of a campaign whose sender is revoked midway", async () => {
    const c = await committee();
    const sender = await member();
    await call("set_group_permissions", [
      board,
      c,
      null,
      [{ key: "email.send", scope: "all" }],
      [],
      false,
      null,
    ]);
    const appointment = (
      await call("assign_leadership", [board, sender, c, null, "chief", null])
    ).appointmentId;
    const campaign = await queued(
      [await member(), await member(), await member()],
      sender
    );
    const first = await call("email_claim_deliveries", [1, 60, campaign]);
    expect(first.deliveries).toHaveLength(1);
    expect(
      (
        await call("email_complete_delivery", [
          first.deliveries[0].id,
          "accepted",
          "p-mid",
          null,
          false,
        ])
      ).code
    ).toBe("SUCCESS");
    const [{ revision }] =
      await admin`SELECT revision FROM private.leadership_appointments WHERE id = ${appointment}`;
    expect(
      (
        await call("revoke_leadership_appointment", [
          board,
          appointment,
          revision,
          "Term ended",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("email_claim_deliveries", [10, 60, campaign])).deliveries
    ).toHaveLength(0);
    const detail = await call("email_get_campaign", [board, campaign]);
    expect(detail.campaign.status).toBe("halted");
    expect(detail.counts).toMatchObject({ accepted: 1, skipped: 2 });
  });

  it("rechecks each recipient before sending", async () => {
    const [stays, leaves, graduates] = [
      await member(),
      await member(),
      await member(),
    ];
    const campaign = await queued([stays, leaves, graduates]);
    // After queuing: one unsubscribes, one is no longer an active member.
    expect(
      (await call("set_own_email_preferences", [leaves, false])).code
    ).toBe("SUCCESS");
    await admin`UPDATE public.members SET status = 'graduate' WHERE id = ${graduates}`;
    const claimed = await call("email_claim_deliveries", [10, 60, campaign]);
    expect(claimed.deliveries.map((d: Result) => d.email)).toEqual(
      (
        await admin`SELECT lower(email) AS e FROM public.members WHERE id = ${stays}`
      ).map((r) => r.e)
    );
    const skipped =
      await admin`SELECT d.member_id, d.skip_reason FROM private.email_deliveries d
      WHERE d.campaign_id = ${campaign} AND d.status = 'skipped'`;
    expect(
      Object.fromEntries(skipped.map((r) => [r.member_id, r.skip_reason]))
    ).toEqual({
      [leaves]: "unsubscribed",
      [graduates]: "not_eligible",
    });
  });

  it("never hands one delivery to two concurrent batches", async () => {
    const recipients = await Promise.all(
      Array.from({ length: 12 }, () => member())
    );
    const campaign = await queued(recipients);
    const [one, two] = await Promise.all([
      call("email_claim_deliveries", [8, 60, campaign], runtime),
      call("email_claim_deliveries", [8, 60, campaign], runtime2),
    ]);
    const claimed = [...one.deliveries, ...two.deliveries].map(
      (d: Result) => d.id
    );
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(12);
  });

  it("unsubscribes through a delivery and cancels queued work", async () => {
    const [m1, m2] = [await member(), await member()];
    const campaign = await queued([m1, m2]);
    const [delivery] =
      await admin`SELECT id, member_id FROM private.email_deliveries WHERE campaign_id = ${campaign} LIMIT 1`;
    expect((await call("email_unsubscribe", [delivery.id])).code).toBe(
      "SUCCESS"
    );
    expect(
      (await call("get_own_email_preferences", [delivery.member_id]))
        .announcements
    ).toBe(false);
    expect((await call("email_unsubscribe", [randomUUID()])).code).toBe(
      "NOT_FOUND"
    );
    expect((await call("email_cancel_campaign", [board, campaign])).code).toBe(
      "SUCCESS"
    );
    expect(
      (await call("email_get_campaign", [board, campaign])).campaign.status
    ).toBe("cancelled");
    expect(
      (await call("email_claim_deliveries", [10, 60, campaign])).deliveries
    ).toHaveLength(0);
  });
});
