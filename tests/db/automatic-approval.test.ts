import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { adminDb, close, runtimeDb } from "./helpers";

// Automatic membership approval (ADR 0029, migration 0037) under the real restricted roles: a
// valid registration is approved at submission, the member record follows the applicant's proven
// email, and nothing about review, duplicates, limits or access is loosened.
describe("automatic membership approval (0037, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Result = Record<string, any>;
  async function call(fn: string, values: unknown[], db: Sql = runtime) {
    const rows = await db.unsafe(
      `SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return rows[0].result as Result;
  }
  const tag = () => randomBytes(4).toString("hex");
  let seq = 0;
  const ip = () => `198.37.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  const PERMISSIONS = [
    "membership.view",
    "membership.review",
    "members.view",
    "committees.view",
    "email.send",
    "settings.membership_policy",
  ];

  async function authUser(email: string, confirmed: boolean) {
    const id = randomUUID();
    await admin`INSERT INTO auth.users(id, email, email_confirmed_at)
      VALUES (${id}, ${email}, ${confirmed ? new Date() : null})`;
    return id;
  }
  async function technical() {
    const id = await authUser(`tech.${tag()}@example.org`, true);
    await admin`INSERT INTO public.administrative_access(user_id, access_level, granted_by)
      VALUES (${id}, 'TECHNICAL', ${id})`;
    return id;
  }
  function register(
    input: {
      email?: string;
      name?: string;
      category?: string;
      address?: string;
    } = {}
  ) {
    const token = randomBytes(32).toString("base64url");
    const email = input.email ?? `new.${tag()}@gmail.com`;
    const category = input.category ?? "university_student";
    const student = category === "university_student";
    return call("submit_membership_application_v2", [
      input.name ?? "Synthetic Registrant",
      email,
      category,
      student ? "squ" : null,
      null,
      student ? 3 : null,
      "civil",
      ["data", "cad"],
      "2026-11-v2",
      createHash("sha256").update(token).digest("hex"),
      input.address ?? ip(),
    ]).then((result) => ({ result, email, token }));
  }
  const application = async (email: string) =>
    (
      await admin<
        Result[]
      >`SELECT * FROM private.membership_applications WHERE email = ${email}`
    )[0];
  const setPolicy = (policy: string | null) =>
    admin`UPDATE private.membership_settings SET approval_policy = ${policy}`;

  let tech: string;
  beforeAll(async () => {
    tech = await technical();
  });
  beforeEach(async () => {
    await setPolicy("automatic");
  });
  afterAll(async () => {
    await setPolicy(null);
    await close(admin, runtime);
  });

  it("the migration recorded the owner's decision as the active policy, audited as a migration", async () => {
    const [entry] = await admin<Result[]>`
      SELECT actor_kind, actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'membership.policy_changed' AND changes ->> 'migration' = '0037'`;
    expect(entry).toMatchObject({
      actor_kind: "migration",
      actor_user_id: null,
      changes: { previous: null, next: "automatic" },
    });
    expect(
      (await runtime`SELECT private.core_schema_version() AS v`)[0].v
    ).toBeGreaterThanOrEqual(37);
  });

  it("approves a valid registration at once, with no reviewer, member record or access", async () => {
    const { result, email } = await register({ name: "  Maryam Al-Said " });
    expect(result).toMatchObject({ code: "SUCCESS", status: "approved" });
    const row = await application(email);
    expect(row).toMatchObject({
      id: result.applicationId,
      full_name: "Maryam Al-Said",
      status: "approved",
      auto_approved: true,
      decided_by: null,
      verified_by: null,
      member_id: null,
      auth_user_id: null,
      activated_at: null,
      category: "university_student",
      institution_id: "squ",
      academic_year: 3,
      discipline: "civil",
    });
    expect(row.decided_at).toBeInstanceOf(Date);
    expect(
      (await admin`SELECT 1 FROM public.members WHERE lower(email) = ${email}`)
        .length
    ).toBe(0);

    // Two audit rows, anonymous, naming the application only.
    const audit = await admin<Result[]>`
      SELECT action, actor_kind, actor_user_id, changes FROM private.uc02_audit
      WHERE changes ->> 'applicationId' = ${result.applicationId} ORDER BY action DESC`;
    expect(audit.map((a) => a.action)).toEqual([
      "membership.submitted",
      "membership.approved",
    ]);
    expect(audit[0].actor_kind).toBe("anonymous");
    expect(audit[1]).toMatchObject({
      actor_kind: "anonymous",
      actor_user_id: null,
      changes: { policy: "automatic", reviewer: null, next: "approved" },
    });
    expect(JSON.stringify(audit)).not.toContain(email);
    expect(JSON.stringify(audit)).not.toContain("Maryam");
  });

  it("the applicant's status token shows the approval straight away", async () => {
    const { token } = await register();
    const status = await call("get_membership_application_status", [
      createHash("sha256").update(token).digest("hex"),
    ]);
    expect(status).toMatchObject({
      code: "SUCCESS",
      status: "approved",
      activated: false,
    });
  });

  it("an unconfirmed sign-up links nothing; the confirmed sign-in creates the member, with no admin rights", async () => {
    const { result, email } = await register({
      category: "industry_professional",
    });
    expect(result.code).toBe("SUCCESS");
    const user = await authUser(email, false);

    expect((await call("get_my_membership", [user])).code).toBe(
      "EMAIL_UNCONFIRMED"
    );
    expect((await application(email)).auth_user_id).toBeNull();
    expect(
      (await admin`SELECT 1 FROM public.members WHERE id = ${user}`).length
    ).toBe(0);

    // The applicant confirms the address (Supabase sets email_confirmed_at) and signs in.
    await admin`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${user}`;
    const mine = await call("get_my_membership", [user]);
    expect(mine).toMatchObject({
      code: "SUCCESS",
      member: { status: "member" },
      application: { status: "approved", activated: true },
    });
    const [member] = await admin<
      Result[]
    >`SELECT * FROM public.members WHERE id = ${user}`;
    expect(member).toMatchObject({
      email,
      full_name: "Synthetic Registrant",
      status: "member",
      category: "industry_professional",
      major: "civil",
    });
    expect(await application(email)).toMatchObject({
      member_id: user,
      auth_user_id: user,
      status: "approved",
    });

    // Membership features open at once.
    expect((await call("get_own_profile", [user])).code).toBe("SUCCESS");

    // Registration grants nothing beyond membership.
    expect(
      (
        await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${user}`
      ).length
    ).toBe(0);
    expect(
      (
        await admin`SELECT 1 FROM private.committee_members WHERE member_id = ${user}`
      ).length
    ).toBe(0);
    expect(
      (
        await admin`SELECT 1 FROM private.leadership_appointments WHERE member_id = ${user}`
      ).length
    ).toBe(0);
    for (const permission of PERMISSIONS) {
      const [{ allowed }] = await admin<{ allowed: boolean }[]>`
        SELECT private.has_permission(${user}::uuid, ${permission}) AS allowed`;
      expect(allowed, permission).toBe(false);
    }

    const [activation] = await admin<Result[]>`
      SELECT actor_kind, actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'membership.activated' AND changes ->> 'applicationId' = ${result.applicationId}`;
    expect(activation).toMatchObject({
      actor_kind: "authenticated",
      actor_user_id: user,
      changes: { reviewer: "applicant", memberId: user },
    });
  });

  it("new registrations appear in the dashboard as approved, and as members once confirmed", async () => {
    const before = await call("get_membership_review_overview", [tech]);
    const { result, email } = await register({ name: "Dashboard Check" });
    const after = await call("get_membership_review_overview", [tech]);
    expect(after.policy).toBe("automatic");
    expect(after.counts.approved).toBe(before.counts.approved + 1);
    expect(after.counts.activationPending).toBe(
      before.counts.activationPending + 1
    );
    expect(after.counts.pending_review).toBe(before.counts.pending_review);

    const listed = await runtime<Result[]>`
      SELECT * FROM private.list_membership_applications(${tech}::uuid, 'approved', ${email},
        NULL, NULL, 10)`;
    expect(listed.map((r) => r.id)).toEqual([result.applicationId]);
    const detail = await call("get_membership_application", [
      tech,
      result.applicationId,
    ]);
    expect(detail.application).toMatchObject({
      status: "approved",
      autoApproved: true,
      decidedBy: null,
      decidedByEmail: null,
    });

    const user = await authUser(email, true);
    await call("get_my_membership", [user]);
    const members = await call("admin_list_members", [tech, email, "all", 0]);
    expect(members.total).toBe(1);
    expect(members.members[0]).toMatchObject({
      id: user,
      name: "Dashboard Check",
      status: "member",
      adminLevel: null,
      committees: [],
    });
  });

  it("duplicates stay refused: an open application, then a member", async () => {
    const { email } = await register();
    expect((await register({ email: email.toUpperCase() })).result.code).toBe(
      "ALREADY_APPLIED"
    );
    const user = await authUser(email, true);
    await call("get_my_membership", [user]);
    expect((await register({ email })).result.code).toBe("ALREADY_MEMBER");
    expect(
      (
        await admin`SELECT count(*)::int AS n FROM private.membership_applications WHERE email = ${email}`
      )[0].n
    ).toBe(1);
  });

  it("invalid input and the per-address limit store nothing", async () => {
    const email = `invalid.${tag()}@gmail.com`;
    const invalid = await call("submit_membership_application_v2", [
      "Synthetic Registrant",
      email,
      "university_student",
      null, // a university student must name the university
      null,
      3,
      "civil",
      [],
      "2026-11-v2",
      randomBytes(32).toString("hex"),
      ip(),
    ]);
    expect(invalid).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "institution",
    });
    expect(await application(email)).toBeUndefined();

    const address = ip();
    for (let i = 0; i < 5; i++)
      expect((await register({ address })).result.code).toBe("SUCCESS");
    const sixth = await register({ address });
    expect(sixth.result.code).toBe("RATE_LIMITED");
    expect(await application(sixth.email)).toBeUndefined();
  });

  it("the reviewed policies still work, and only a permitted user changes the policy", async () => {
    await setPolicy("single_step");
    const options = await call("get_membership_options", []);
    expect(options.approval).toBe("review");
    const { result, email } = await register();
    expect(result).toMatchObject({ code: "SUCCESS", status: "pending_review" });
    expect(await application(email)).toMatchObject({
      status: "pending_review",
      auto_approved: false,
      decided_at: null,
    });

    const outsider = await authUser(`outsider.${tag()}@example.org`, true);
    expect(
      (await call("set_membership_approval_policy", [outsider, "automatic"]))
        .code
    ).toBe("FORBIDDEN");
    expect(
      await call("set_membership_approval_policy", [tech, "automatic"])
    ).toMatchObject({ code: "SUCCESS", policy: "automatic" });
    expect((await call("get_membership_options", [])).approval).toBe(
      "automatic"
    );
    const [changed] = await admin<Result[]>`
      SELECT actor_kind, actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'membership.policy_changed' AND actor_user_id = ${tech}
      ORDER BY id DESC LIMIT 1`;
    expect(changed).toMatchObject({
      actor_kind: "authenticated",
      changes: { previous: "single_step", next: "automatic" },
    });

    // An application left pending from before the switch is approved by a reviewer in one step.
    const [{ revision }] = await admin<Result[]>`
      SELECT revision FROM private.membership_applications WHERE id = ${result.applicationId}`;
    expect(
      await call("review_membership_application", [
        tech,
        result.applicationId,
        revision,
        "approve",
        null,
      ])
    ).toMatchObject({ code: "SUCCESS", status: "approved" });
    expect(await application(email)).toMatchObject({
      auto_approved: false,
      decided_by: tech,
    });
  });

  it("the table refuses an automatic approval that is not a plain approval", async () => {
    const base = {
      full_name: "Constraint Check",
      academic_year: 2,
      discipline: "civil",
      consent_version: "2026-11-v2",
      category: "industry_professional",
    };
    const insert = (
      status: string,
      decidedAt: Date | null,
      decidedBy: string | null
    ) =>
      admin`INSERT INTO private.membership_applications (full_name, email, academic_year, discipline,
          consent_version, category, status_token_hash, status, decided_at, decided_by, auto_approved)
        VALUES (${base.full_name}, ${`c.${tag()}@gmail.com`}, ${base.academic_year}, ${base.discipline},
          ${base.consent_version}, ${base.category}, ${randomBytes(32).toString("hex")},
          ${status}::private.membership_application_status, ${decidedAt}, ${decidedBy}, true)`;
    await expect(insert("pending_review", null, null)).rejects.toThrow(
      /membership_decision_consistency/
    );
    await expect(insert("rejected", new Date(), null)).rejects.toThrow(
      /membership_decision_consistency/
    );
    await expect(insert("approved", new Date(), tech)).rejects.toThrow(
      /membership_decision_consistency/
    );
    await expect(insert("approved", null, null)).rejects.toThrow(
      /membership_decision_consistency/
    );
  });
});
