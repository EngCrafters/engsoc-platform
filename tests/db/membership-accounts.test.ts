import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminDb, close, runtimeDb } from "./helpers";

/**
 * Migration 0027: applicants' own Auth accounts (ADR 0019), as the restricted
 * `app_runtime` login. Supabase Auth owns passwords; these tests prove the
 * database side: an application is linked only to an identity whose email is
 * confirmed (or that Core invited), signing in grants nothing, and approval
 * still needs reviewers and the approval policy. Every identity is synthetic.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("synthetic test card"),
]);
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
type Result = { code: string; [key: string]: unknown };

describe("membership applicant accounts", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const people: Record<string, string> = {};
  let seq = 0;
  const RUN = 40_000 + Math.floor(Math.random() * 50_000);

  async function call(
    sql: Sql,
    fn: string,
    values: unknown[]
  ): Promise<Result> {
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await sql.unsafe(
      `SELECT private.${fn}(${placeholders}) AS result`,
      values as never[]
    );
    return rows[0].result as Result;
  }

  async function apply(email?: string) {
    seq += 1;
    const values = {
      email: email ?? `acct${RUN}${seq}@squ.edu.om`,
      universityId: String(RUN * 1000 + seq),
    };
    const result = await call(runtime, "submit_membership_application", [
      "Synthetic Applicant",
      values.email,
      values.universityId,
      2,
      "civil",
      [],
      "2026-10-v1",
      sha(randomUUID()),
      "image/png",
      sha(PNG),
      PNG,
      `198.18.0.${(seq % 250) + 1}`,
    ]);
    expect(result.code).toBe("SUCCESS");
    return { ...values, id: result.applicationId as string };
  }

  /** A self-registered Auth identity, as Supabase's sign-up creates it. */
  async function signUp(email: string, confirmed: boolean) {
    const id = randomUUID();
    await admin`INSERT INTO auth.users (id, email, email_confirmed_at)
      VALUES (${id}, ${email}, ${confirmed ? new Date() : null})`;
    return id;
  }
  const confirm = (id: string) =>
    admin`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${id}`;
  const mine = (user: string) => call(runtime, "get_my_membership", [user]);
  const review = async (actor: string, id: string, decision: string) => {
    const [{ revision }] = await admin<{ revision: number }[]>`
      SELECT revision FROM private.membership_applications WHERE id = ${id}`;
    return call(runtime, "review_membership_application", [
      actor,
      id,
      revision,
      decision,
      null,
    ]);
  };
  const setPolicy = (policy: string) =>
    call(runtime, "set_membership_approval_policy", [people.technical, policy]);

  beforeAll(async () => {
    const [{ id: sa }] = await admin<{ id: string }[]>`
      SELECT id FROM public.committees WHERE slug = 'society-affairs'`;
    for (const name of ["societyAffairs", "board", "technical"]) {
      people[name] = randomUUID();
      await admin`INSERT INTO auth.users (id, email, email_confirmed_at)
        VALUES (${people[name]}, ${`acct-${name.toLowerCase()}-${people[name].slice(0, 6)}@example.test`}, now())`;
    }
    const grant = (user: string, level: string, committee: string | null) =>
      admin`INSERT INTO public.administrative_access (user_id, access_level, committee_id, granted_by)
            VALUES (${user}, ${level}::public.administrative_access_level, ${committee}, ${user})`;
    await grant(people.societyAffairs, "COMMITTEE_MANAGER", sa);
    await grant(people.board, "BOARD_ADMIN", null);
    await grant(people.technical, "TECHNICAL", null);
  });

  afterEach(async () => {
    await admin`UPDATE private.membership_settings SET approval_policy = NULL`;
  });

  afterAll(async () => close(admin, runtime));

  it("shows and links nothing for an unconfirmed email", async () => {
    const app = await apply();
    const user = await signUp(app.email, false);
    expect(await mine(user)).toEqual({ code: "EMAIL_UNCONFIRMED" });
    const [row] =
      await admin`SELECT auth_user_id FROM private.membership_applications WHERE id = ${app.id}`;
    expect(row.auth_user_id).toBeNull();
  });

  it("links the application to the confirmed identity once, without disturbing the review", async () => {
    const app = await apply();
    const user = await signUp(app.email, true);
    const [{ revision: before }] =
      await admin`SELECT revision FROM private.membership_applications WHERE id = ${app.id}`;
    const first = await mine(user);
    expect(first).toMatchObject({
      code: "SUCCESS",
      member: null,
      application: { status: "pending_review", activated: false },
    });
    expect(JSON.stringify(first)).not.toMatch(
      /note|reviewer|document|universityId/i
    );
    const [row] =
      await admin`SELECT auth_user_id, revision FROM private.membership_applications WHERE id = ${app.id}`;
    expect(row).toEqual({ auth_user_id: user, revision: before });
    // Signing in again (a browser retry) links nothing new.
    await mine(user);
    const linked = await admin`SELECT 1 FROM private.uc02_audit
      WHERE action = 'membership.account_linked' AND changes ->> 'applicationId' = ${app.id}`;
    expect(linked).toHaveLength(1);
  });

  it("answers an account without an application, and grants it nothing", async () => {
    const user = await signUp(`acct-none-${RUN}@squ.edu.om`, true);
    expect(await mine(user)).toEqual({
      code: "SUCCESS",
      member: null,
      application: null,
    });
    expect(
      await admin`SELECT 1 FROM public.members WHERE id = ${user}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${user}`
    ).toHaveLength(0);
  });

  it("shows the applicant their own verification, and never approves on sign-in", async () => {
    const app = await apply();
    const user = await signUp(app.email, true);
    expect((await review(people.societyAffairs, app.id, "verify")).code).toBe(
      "SUCCESS"
    );
    expect(await mine(user)).toMatchObject({
      application: { status: "verified" },
      member: null,
    });
    // The policy is unset: nobody can approve, and the applicant's sign-in changes nothing.
    expect((await review(people.board, app.id, "approve")).code).toBe(
      "POLICY_NOT_CONFIRMED"
    );
    expect(await mine(user)).toMatchObject({
      application: { status: "verified" },
      member: null,
    });
  });

  it("activates a confirmed self-registered applicant at approval without an invitation", async () => {
    await setPolicy("single_step");
    const app = await apply();
    const user = await signUp(app.email, true);
    expect((await review(people.board, app.id, "approve")).code).toBe(
      "SUCCESS"
    );
    expect(
      await call(runtime, "activate_membership", [people.board, app.id, "none"])
    ).toEqual({
      code: "SUCCESS",
      memberId: user,
    });
    expect(await mine(user)).toMatchObject({
      member: { status: "member" },
      application: { status: "approved", activated: true },
    });
  });

  it("waits for an unconfirmed applicant, then completes activation at their confirmed sign-in", async () => {
    await setPolicy("single_step");
    const app = await apply();
    const user = await signUp(app.email, false);
    expect((await review(people.board, app.id, "approve")).code).toBe(
      "SUCCESS"
    );
    expect(
      (
        await call(runtime, "activate_membership", [
          people.board,
          app.id,
          "none",
        ])
      ).code
    ).toBe("EMAIL_UNCONFIRMED");
    expect(
      await admin`SELECT 1 FROM public.members WHERE id = ${user}`
    ).toHaveLength(0);

    await confirm(user);
    await setPolicy("unset"); // Approval was already given; the policy is not re-applied.
    expect(await mine(user)).toMatchObject({
      member: { status: "member" },
      application: { status: "approved", activated: true },
    });
    const [audit] = await admin<{ changes: Record<string, unknown> }[]>`
      SELECT changes FROM private.uc02_audit
      WHERE action = 'membership.activated' AND changes ->> 'applicationId' = ${app.id}`;
    expect(audit.changes).toMatchObject({
      memberId: user,
      invitation: "none",
      reviewer: "applicant",
    });
    expect(
      await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${user}`
    ).toHaveLength(0);
  });

  it("keeps the invitation path for applicants without an account", async () => {
    await setPolicy("single_step");
    const app = await apply();
    expect((await review(people.board, app.id, "approve")).code).toBe(
      "SUCCESS"
    );
    expect(
      (
        await call(runtime, "activate_membership", [
          people.board,
          app.id,
          "none",
        ])
      ).code
    ).toBe("NEEDS_INVITATION");
    const invited = randomUUID();
    await admin`INSERT INTO auth.users (id, email, invited_at) VALUES (${invited}, ${app.email}, now())`;
    expect(
      (
        await call(runtime, "activate_membership", [
          people.board,
          app.id,
          "sent",
        ])
      ).code
    ).toBe("SUCCESS");
  });

  it("follows the latest application after a rejection and a new application", async () => {
    const email = `acct-again-${RUN}@squ.edu.om`;
    const first = await apply(email);
    const user = await signUp(email, true);
    expect((await review(people.societyAffairs, first.id, "reject")).code).toBe(
      "SUCCESS"
    );
    expect(await mine(user)).toMatchObject({
      application: { status: "rejected" },
    });
    await apply(email);
    expect(await mine(user)).toMatchObject({
      application: { status: "pending_review" },
    });
  });

  it("is executable only by the runtime login", async () => {
    const roles = await admin`
      SELECT has_function_privilege('anon', 'private.get_my_membership(uuid)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'private.get_my_membership(uuid)', 'EXECUTE') AS auth,
             has_function_privilege('app_runtime',
               'private.membership_complete_activation(uuid, uuid, uuid, text, text)', 'EXECUTE') AS helper`;
    expect(roles[0]).toEqual({ anon: false, auth: false, helper: false });
  });
});
