import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { adminDb, close, runtimeDb } from "./helpers";

// The account activation setting (ADR 0030, migration 0038) under the real restricted roles. The
// Auth Admin API is outside the database: these tests play its part by inserting the auth.users
// row Core would create (confirmed by the Admin API, never signed in).
describe("account activation setting (0038, real restricted roles)", () => {
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
  const ip = () => `198.38.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");

  async function authUser(
    email: string,
    options: { id?: string; confirmed?: boolean; signedIn?: boolean } = {}
  ) {
    const id = options.id ?? randomUUID();
    await admin`INSERT INTO auth.users(id, email, email_confirmed_at, last_sign_in_at)
      VALUES (${id}, ${email}, ${options.confirmed === false ? null : new Date()},
        ${options.signedIn ? new Date() : null})`;
    return id;
  }
  async function withPermission() {
    const id = await authUser(`tech.${tag()}@example.org`);
    await admin`INSERT INTO public.administrative_access(user_id, access_level, granted_by)
      VALUES (${id}, 'TECHNICAL', ${id})`;
    return id;
  }
  async function register(email = `reg.${tag()}@gmail.com`) {
    const token = randomBytes(32).toString("base64url");
    const result = await call("submit_membership_application_v2", [
      "Synthetic Registrant",
      email,
      "industry_professional",
      null,
      null,
      null,
      "civil",
      ["data"],
      "2026-11-v2",
      hash(token),
      ip(),
    ]);
    return { result, email, tokenHash: hash(token) };
  }
  const application = async (email: string) =>
    (
      await admin<
        Result[]
      >`SELECT * FROM private.membership_applications WHERE email = ${email}`
    )[0];
  const setSettings = (policy: string | null, activation: string) =>
    admin`UPDATE private.membership_settings SET approval_policy = ${policy}, account_activation = ${activation}`;

  let tech: string;
  beforeAll(async () => {
    tech = await withPermission();
  });
  beforeEach(async () => {
    await setSettings("automatic", "immediate");
  });
  afterAll(async () => {
    await setSettings(null, "email_confirmation");
    await close(admin, runtime);
  });

  it("defaults to email confirmation, and the submission records and reports the mode", async () => {
    await setSettings("automatic", "email_confirmation");
    expect((await call("get_membership_options", [])).accountActivation).toBe(
      "email_confirmation"
    );
    const confirm = await register();
    expect(confirm.result).toMatchObject({
      code: "SUCCESS",
      status: "approved",
      accountActivation: "email_confirmation",
    });
    expect((await application(confirm.email)).account_activation).toBe(
      "email_confirmation"
    );
    // An email-confirmation registration never gets an account from Core.
    expect(
      (await call("begin_immediate_account", [confirm.tokenHash])).code
    ).toBe("NOT_IMMEDIATE");

    await setSettings("automatic", "immediate");
    expect((await call("get_membership_options", [])).accountActivation).toBe(
      "immediate"
    );
    const immediate = await register();
    expect(immediate.result.accountActivation).toBe("immediate");
    expect((await application(immediate.email)).account_activation).toBe(
      "immediate"
    );
  });

  it("immediate: reserves one account ID, links the created account and makes the member, with no access", async () => {
    const { email, tokenHash, result } = await register();
    const begin = await call("begin_immediate_account", [tokenHash]);
    expect(begin).toMatchObject({
      code: "CREATE",
      email,
      applicationId: result.applicationId,
    });
    // Asking again (a retry before the account exists) reserves the same ID.
    expect((await call("begin_immediate_account", [tokenHash])).userId).toBe(
      begin.userId
    );

    // Core creates the account with that ID, confirmed by the Admin API.
    await authUser(email, { id: begin.userId });
    expect(await call("begin_immediate_account", [tokenHash])).toMatchObject({
      code: "LINK",
      userId: begin.userId,
    });
    const done = await call("complete_immediate_account", [
      tokenHash,
      begin.userId,
    ]);
    expect(done).toMatchObject({ code: "SUCCESS", member: true });
    expect(await application(email)).toMatchObject({
      auth_user_id: begin.userId,
      member_id: begin.userId,
      immediate_account_id: begin.userId,
    });
    expect(
      (
        await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${begin.userId}`
      ).length
    ).toBe(0);
    const [linked] = await admin<Result[]>`
      SELECT changes FROM private.uc02_audit WHERE action = 'membership.account_linked'
        AND changes ->> 'applicationId' = ${result.applicationId}`;
    expect(linked.changes).toMatchObject({
      accountActivation: "immediate",
      emailVerified: false,
    });

    // The dashboard says the address was not verified.
    const detail = await call("get_membership_application", [
      tech,
      result.applicationId,
    ]);
    expect(detail.application).toMatchObject({
      accountActivation: "immediate",
      accountUnverified: true,
    });
  });

  it("never signs anyone in to an account that already existed, or once the new one has signed in", async () => {
    // Someone (perhaps the real owner, perhaps an administrator) already has this address.
    const existing = await register();
    const owner = await authUser(existing.email);
    expect(
      await call("begin_immediate_account", [existing.tokenHash])
    ).toMatchObject({ code: "ACCOUNT_EXISTS" });
    expect(
      (await call("complete_immediate_account", [existing.tokenHash, owner]))
        .code
    ).toBe("INVALID");

    // The created account, once it has signed in, gets no further sign-in token.
    const fresh = await register();
    const begin = await call("begin_immediate_account", [fresh.tokenHash]);
    await authUser(fresh.email, { id: begin.userId, signedIn: true });
    expect(
      (await call("begin_immediate_account", [fresh.tokenHash])).code
    ).toBe("ALREADY_SET_UP");
  });

  it("refuses unknown tokens, expired applications, rejected ones and an unconfirmed or mismatched account", async () => {
    expect((await call("begin_immediate_account", ["0".repeat(64)])).code).toBe(
      "NOT_FOUND"
    );
    expect((await call("begin_immediate_account", ["nope"])).code).toBe(
      "NOT_FOUND"
    );

    const old = await register();
    await admin`UPDATE private.membership_applications SET submitted_at = now() - interval '2 hours'
      WHERE email = ${old.email}`;
    expect((await call("begin_immediate_account", [old.tokenHash])).code).toBe(
      "EXPIRED"
    );

    const other = await register();
    const begin = await call("begin_immediate_account", [other.tokenHash]);
    // An account with the reserved ID but another address, or unconfirmed, is not ours.
    await authUser(`elsewhere.${tag()}@gmail.com`, { id: begin.userId });
    expect(
      (
        await call("complete_immediate_account", [
          other.tokenHash,
          begin.userId,
        ])
      ).code
    ).toBe("INVALID");
    expect(
      (
        await call("complete_immediate_account", [
          other.tokenHash,
          randomUUID(),
        ])
      ).code
    ).toBe("INVALID");

    const unconfirmed = await register();
    const reserved = await call("begin_immediate_account", [
      unconfirmed.tokenHash,
    ]);
    await authUser(unconfirmed.email, {
      id: reserved.userId,
      confirmed: false,
    });
    expect(
      (
        await call("complete_immediate_account", [
          unconfirmed.tokenHash,
          reserved.userId,
        ])
      ).code
    ).toBe("INVALID");
  });

  it("under a reviewed policy the account is immediate but membership still waits for approval", async () => {
    await setSettings("single_step", "immediate");
    const { email, tokenHash, result } = await register();
    expect(result).toMatchObject({
      status: "pending_review",
      accountActivation: "immediate",
    });
    const begin = await call("begin_immediate_account", [tokenHash]);
    await authUser(email, { id: begin.userId });
    expect(
      await call("complete_immediate_account", [tokenHash, begin.userId])
    ).toMatchObject({ code: "SUCCESS", member: false });
    expect(await application(email)).toMatchObject({
      auth_user_id: begin.userId,
      member_id: null,
      status: "pending_review",
    });
  });

  it("only a holder of the settings permission changes the mode, and every change is audited", async () => {
    await setSettings("automatic", "email_confirmation");
    const outsider = await authUser(`outsider.${tag()}@example.org`);
    expect(
      (await call("set_membership_account_activation", [outsider, "immediate"]))
        .code
    ).toBe("FORBIDDEN");
    expect(
      (await call("set_membership_account_activation", [tech, "sometimes"]))
        .code
    ).toBe("VALIDATION_ERROR");
    expect(
      await call("set_membership_account_activation", [tech, "immediate"])
    ).toMatchObject({ code: "SUCCESS", accountActivation: "immediate" });
    const [entry] = await admin<Result[]>`
      SELECT actor_kind, actor_user_id, changes FROM private.uc02_audit
      WHERE action = 'membership.policy_changed' AND changes ->> 'setting' = 'account_activation'
        AND actor_user_id = ${tech} ORDER BY occurred_at DESC LIMIT 1`;
    expect(entry).toMatchObject({
      actor_kind: "authenticated",
      changes: { previous: "email_confirmation", next: "immediate" },
    });
    // The approval policy is a separate setting and did not move.
    expect(
      (
        await admin<
          { approval_policy: string }[]
        >`SELECT approval_policy FROM private.membership_settings`
      )[0].approval_policy
    ).toBe("automatic");
  });
  it("Board Administration may change it too (0039); a Committee Manager may not", async () => {
    await setSettings("automatic", "email_confirmation");
    const board = await authUser(`board.${tag()}@example.org`);
    await admin`INSERT INTO public.administrative_access(user_id, access_level, granted_by)
      VALUES (${board}, 'BOARD_ADMIN', ${board})`;
    const [committee] = await admin<{ id: string }[]>`
      SELECT id FROM public.committees WHERE slug IS NOT NULL ORDER BY slug LIMIT 1`;
    const manager = await authUser(`manager.${tag()}@example.org`);
    await admin`INSERT INTO public.administrative_access(user_id, access_level, committee_id, granted_by)
      VALUES (${manager}, 'COMMITTEE_MANAGER', ${committee.id}, ${manager})`;
    expect(
      (await call("set_membership_account_activation", [manager, "immediate"]))
        .code
    ).toBe("FORBIDDEN");
    expect(
      await call("set_membership_account_activation", [board, "immediate"])
    ).toMatchObject({ code: "SUCCESS", accountActivation: "immediate" });
    expect(
      (
        await call("set_membership_account_activation", [
          board,
          "email_confirmation",
        ])
      ).code
    ).toBe("SUCCESS");
    const [{ label }] = await admin<{ label: string }[]>`
      SELECT label_en AS label FROM private.permission_catalog WHERE key = 'settings.membership_policy'`;
    expect(label).toBe("Membership settings");
  });
});
