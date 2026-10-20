import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  CONSENT_VERSIONS,
  MAX_INTERESTS,
  MEMBERSHIP_DISCIPLINES,
  MEMBERSHIP_INTERESTS,
} from "../../lib/membership/types";
import { adminDb, close, runtimeDb } from "./helpers";

/**
 * UC-01 membership applications (ADR 0017, migration 0025), exercised through
 * the real routines as the restricted `app_runtime` login against PostgreSQL.
 * Every applicant, card and identity here is synthetic.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("synthetic test card, not a real student ID"),
]);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const tokenHash = () => sha(Buffer.from(randomUUID()));

type Result = { code: string; [key: string]: unknown };

describe("membership applications", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const people: Record<string, string> = {};
  const emails: Record<string, string> = {};
  let ipCounter = 0;
  let submissions = 0;
  const RUN_SEED = 10_000 + Math.floor(Math.random() * 89_000);

  /** A fresh documentation-range address per submission, so the rate limit stays out of the way. */
  const nextIp = () => {
    ipCounter += 1;
    return `203.0.113.${(ipCounter % 250) + 1}`;
  };

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

  async function submit(
    overrides: Partial<{
      fullName: string;
      email: string;
      universityId: string;
      year: number;
      discipline: string;
      interests: string[];
      consent: string;
      token: string;
      mediaType: string;
      content: Buffer;
      sha: string;
      ip: string;
    }> = {}
  ) {
    const content = overrides.content ?? PNG;
    const unique = randomUUID().slice(0, 8);
    submissions += 1;
    const values = {
      fullName: "Test Applicant",
      email: `t${unique}@squ.edu.om`,
      // Eight digits, unique within the run: a seed per run plus a counter.
      universityId: String(RUN_SEED * 1000 + submissions),
      year: 2,
      discipline: "mechanical",
      interests: ["cad", "robotics"],
      consent: "2026-10-v1",
      token: tokenHash(),
      mediaType: "image/png",
      sha: sha(content),
      ip: nextIp(),
      ...overrides,
    };
    const result = await call(runtime, "submit_membership_application", [
      values.fullName,
      values.email,
      values.universityId,
      values.year,
      values.discipline,
      values.interests,
      values.consent,
      values.token,
      values.mediaType,
      values.sha,
      content,
      values.ip,
    ]);
    return { result, ...values };
  }

  const review = (
    actor: string,
    id: string,
    revision: number,
    decision: string,
    note: string | null = null
  ) =>
    call(runtime, "review_membership_application", [
      actor,
      id,
      revision,
      decision,
      note,
    ]);
  const detail = (actor: string, id: string) =>
    call(runtime, "get_membership_application", [actor, id]);
  const revisionOf = async (id: string) =>
    (
      await admin<
        { revision: number }[]
      >`SELECT revision FROM private.membership_applications WHERE id = ${id}`
    )[0].revision;
  const setPolicy = (policy: string) =>
    call(runtime, "set_membership_approval_policy", [people.technical, policy]);

  beforeAll(async () => {
    const committees = await admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM public.committees WHERE slug IN ('society-affairs', 'media')`;
    const committee = Object.fromEntries(committees.map((c) => [c.slug, c.id]));
    for (const name of [
      "societyAffairs",
      "media",
      "board",
      "board2",
      "technical",
      "noAccess",
      "revoked",
    ]) {
      people[name] = randomUUID();
      emails[name] =
        `${name.toLowerCase()}-${people[name].slice(0, 6)}@example.test`;
      await admin`INSERT INTO auth.users (id, email) VALUES (${people[name]}, ${emails[name]})`;
    }
    const grant = (user: string, level: string, committeeId: string | null) =>
      admin`INSERT INTO public.administrative_access (user_id, access_level, committee_id, granted_by)
            VALUES (${user}, ${level}::public.administrative_access_level, ${committeeId}, ${user})`;
    await grant(
      people.societyAffairs,
      "COMMITTEE_MANAGER",
      committee["society-affairs"]
    );
    await grant(people.media, "COMMITTEE_MANAGER", committee.media);
    await grant(people.board, "BOARD_ADMIN", null);
    await grant(people.board2, "BOARD_ADMIN", null);
    await grant(people.technical, "TECHNICAL", null);
    await grant(
      people.revoked,
      "COMMITTEE_MANAGER",
      committee["society-affairs"]
    );
    await admin`UPDATE public.administrative_access SET revoked_at = now(), revoked_by = ${people.technical}
                WHERE user_id = ${people.revoked}`;
  });

  afterEach(async () => {
    await admin`UPDATE private.membership_settings SET approval_policy = NULL`;
  });

  afterAll(async () => close(admin, runtime));

  it("stores a valid application with its document and audits it without personal data", async () => {
    const { result, email, universityId, token } = await submit({
      fullName: "  Aisha Al-Hinai  ",
    });
    expect(result.code).toBe("SUCCESS");
    const id = result.applicationId as string;

    const [row] =
      await admin`SELECT * FROM private.membership_applications WHERE id = ${id}`;
    expect(row).toMatchObject({
      full_name: "Aisha Al-Hinai",
      email,
      university_id: universityId,
      status: "pending_review",
      status_token_hash: token,
      verified_by: null,
      decided_by: null,
      member_id: null,
    });
    const [doc] =
      await admin`SELECT media_type, byte_size, sha256 FROM private.membership_documents WHERE application_id = ${id}`;
    expect(doc).toEqual({
      media_type: "image/png",
      byte_size: PNG.length,
      sha256: sha(PNG),
    });

    const audit = await admin<{ actor_kind: string; changes: unknown }[]>`
      SELECT actor_kind, changes FROM private.uc02_audit WHERE changes ->> 'applicationId' = ${id}`;
    expect(audit).toEqual([
      { actor_kind: "anonymous", changes: { applicationId: id } },
    ]);
    expect(JSON.stringify(audit)).not.toContain(email);
  });

  it("accepts Arabic names and names with apostrophes and hyphens", async () => {
    for (const fullName of ["عائشة بنت سالم الهنائية", "Ma'mun Al-Rawahi"]) {
      expect((await submit({ fullName })).result.code).toBe("SUCCESS");
    }
  });

  it("accepts exactly the vocabularies the server and website use", async () => {
    for (const discipline of MEMBERSHIP_DISCIPLINES) {
      expect((await submit({ discipline })).result.code, discipline).toBe(
        "SUCCESS"
      );
    }
    for (let i = 0; i < MEMBERSHIP_INTERESTS.length; i += MAX_INTERESTS) {
      const interests = MEMBERSHIP_INTERESTS.slice(i, i + MAX_INTERESTS);
      expect((await submit({ interests })).result.code, String(interests)).toBe(
        "SUCCESS"
      );
    }
    for (const consent of CONSENT_VERSIONS) {
      expect((await submit({ consent })).result.code, consent).toBe("SUCCESS");
    }
    expect((await submit({ interests: [] })).result.code).toBe("SUCCESS");
  });

  it("validates every field and the document inside the routine", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ fullName: "   " }, "fullName"],
      [{ fullName: "x".repeat(201) }, "fullName"],
      [{ fullName: "bad\u0007name" }, "fullName"],
      [{ email: "someone@gmail.com" }, "email"],
      [{ email: "not-an-email" }, "email"],
      [{ email: "x@squ.edu.om.evil.example" }, "email"],
      [{ universityId: "12345" }, "universityId"],
      [{ universityId: "12345678901" }, "universityId"],
      [{ universityId: "12a456" }, "universityId"],
      [{ year: 0 }, "academicYear"],
      [{ year: 6 }, "academicYear"],
      [{ discipline: "aerospace" }, "discipline"],
      [{ interests: ["cad", "cad"] }, "interests"],
      [{ interests: ["cad", "data", "power", "hse", "quality"] }, "interests"],
      [{ interests: ["hacking"] }, "interests"],
      [{ consent: "prototype" }, "consent"],
      [{ token: "short" }, "statusToken"],
      [{ mediaType: "image/gif" }, "idDocument"],
      [{ sha: "0".repeat(64) }, "idDocument"],
    ];
    for (const [overrides, field] of bad) {
      const { result } = await submit(overrides as never);
      expect(result, JSON.stringify(overrides)).toEqual({
        code: "VALIDATION_ERROR",
        field,
      });
    }
    const big = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
    expect((await submit({ content: big, sha: sha(big) })).result).toEqual({
      code: "VALIDATION_ERROR",
      field: "idDocument",
    });
  });

  it("treats the same email or student ID as the same person, and allows a new application after rejection", async () => {
    const first = await submit();
    expect(first.result.code).toBe("SUCCESS");
    expect(
      (await submit({ email: first.email.toUpperCase() })).result.code
    ).toBe("ALREADY_APPLIED");
    expect(
      (await submit({ universityId: first.universityId })).result.code
    ).toBe("ALREADY_APPLIED");

    const id = first.result.applicationId as string;
    expect((await review(people.board, id, 1, "reject")).code).toBe("SUCCESS");
    expect(
      (await submit({ email: first.email, universityId: first.universityId }))
        .result.code
    ).toBe("SUCCESS");
  });

  it("lets exactly one of two concurrent duplicate submissions through", async () => {
    const email = `race-${randomUUID().slice(0, 8)}@squ.edu.om`;
    const results = await Promise.all([submit({ email }), submit({ email })]);
    expect(results.map((r) => r.result.code).sort()).toEqual([
      "ALREADY_APPLIED",
      "SUCCESS",
    ]);
    const [{ count }] = await admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM private.membership_applications WHERE email = ${email}`;
    expect(count).toBe(1);
  });

  it("rate limits a single address to five submissions an hour", async () => {
    const ip = "198.51.100.77";
    const codes: string[] = [];
    for (let i = 0; i < 6; i += 1)
      codes.push((await submit({ ip })).result.code);
    expect(codes).toEqual([
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
      "RATE_LIMITED",
    ]);
  });

  it("reports the applicant's own status by token, with verification shown as still under review", async () => {
    const { result, token } = await submit();
    const id = result.applicationId as string;
    const status = () =>
      call(runtime, "get_membership_application_status", [token]);
    expect(await status()).toMatchObject({
      code: "SUCCESS",
      status: "pending_review",
      activated: false,
      decidedAt: null,
    });
    await review(people.societyAffairs, id, 1, "verify");
    expect(await status()).toMatchObject({ status: "pending_review" });
    await review(people.board, id, 2, "reject");
    expect(await status()).toMatchObject({
      status: "rejected",
      decidedAt: expect.any(String),
    });
    expect(
      await call(runtime, "get_membership_application_status", [tokenHash()])
    ).toEqual({ code: "NOT_FOUND" });
  });

  it("grants review only to Society Affairs managers and Senior Management (Board, Technical)", async () => {
    const { result } = await submit();
    const id = result.applicationId as string;
    for (const allowed of ["societyAffairs", "board", "technical"]) {
      expect(
        (await call(runtime, "can_review_membership", [
          people[allowed],
        ])) as unknown,
        allowed
      ).toBe(true);
      expect((await detail(people[allowed], id)).code, allowed).toBe("SUCCESS");
    }
    for (const denied of ["media", "noAccess", "revoked"]) {
      expect(
        (await call(runtime, "can_review_membership", [
          people[denied],
        ])) as unknown,
        denied
      ).toBe(false);
      expect((await detail(people[denied], id)).code, denied).toBe("FORBIDDEN");
      expect(
        (
          await call(runtime, "get_membership_review_overview", [
            people[denied],
          ])
        ).code
      ).toBe("FORBIDDEN");
      expect((await review(people[denied], id, 1, "verify")).code, denied).toBe(
        "FORBIDDEN"
      );
      expect((await review(people[denied], id, 1, "reject")).code, denied).toBe(
        "FORBIDDEN"
      );
      const list =
        await runtime`SELECT * FROM private.list_membership_applications(${people[denied]}, 'all', NULL, NULL, NULL, 50)`;
      expect(list, denied).toHaveLength(0);
      const doc =
        await runtime`SELECT * FROM private.get_membership_document(${people[denied]}, ${id})`;
      expect(doc, denied).toHaveLength(0);
    }
  });

  it("refuses approval and activation until the owner's policy is recorded", async () => {
    const { result } = await submit();
    const id = result.applicationId as string;
    expect((await review(people.board, id, 1, "approve")).code).toBe(
      "POLICY_NOT_CONFIRMED"
    );
    expect((await review(people.societyAffairs, id, 1, "verify")).code).toBe(
      "SUCCESS"
    );
    expect((await review(people.board, id, 2, "approve")).code).toBe(
      "POLICY_NOT_CONFIRMED"
    );
    expect(
      (await call(runtime, "activate_membership", [people.board, id, "none"]))
        .code
    ).toBe("POLICY_NOT_CONFIRMED");
    const [{ status }] = await admin<
      { status: string }[]
    >`SELECT status::text FROM private.membership_applications WHERE id = ${id}`;
    expect(status).toBe("verified");
  });

  it("lets only a Technical user record the policy, with audit", async () => {
    expect(
      (
        await call(runtime, "set_membership_approval_policy", [
          people.board,
          "two_step",
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call(runtime, "set_membership_approval_policy", [
          people.societyAffairs,
          "single_step",
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call(runtime, "set_membership_approval_policy", [
          people.technical,
          "everyone",
        ])
      ).code
    ).toBe("VALIDATION_ERROR");
    expect((await setPolicy("two_step")).code).toBe("SUCCESS");
    const [audit] = await admin<{ changes: unknown }[]>`
      SELECT changes FROM private.uc02_audit WHERE action = 'membership.policy_changed' ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit.changes).toEqual({ previous: null, next: "two_step" });
  });

  it("two_step: Society Affairs verifies, a different Senior Management reviewer approves, and the card is deleted", async () => {
    await setPolicy("two_step");
    const { result } = await submit();
    const id = result.applicationId as string;
    expect((await review(people.board, id, 1, "approve")).code).toBe(
      "VERIFICATION_REQUIRED"
    );
    expect((await review(people.societyAffairs, id, 1, "verify")).code).toBe(
      "SUCCESS"
    );
    expect((await review(people.societyAffairs, id, 2, "approve")).code).toBe(
      "SENIOR_APPROVAL_REQUIRED"
    );
    expect((await review(people.media, id, 2, "approve")).code).toBe(
      "FORBIDDEN"
    );
    expect((await review(people.board, id, 2, "approve")).code).toBe("SUCCESS");

    const [row] =
      await admin`SELECT status::text, decided_by, document_deleted_at FROM private.membership_applications WHERE id = ${id}`;
    expect(row).toMatchObject({
      status: "approved",
      decided_by: people.board,
      document_deleted_at: expect.any(Date),
    });
    expect(
      await admin`SELECT 1 FROM private.membership_documents WHERE application_id = ${id}`
    ).toHaveLength(0);
  });

  it("two_step: the reviewer who verified cannot also give final approval", async () => {
    await setPolicy("two_step");
    const { result } = await submit();
    const id = result.applicationId as string;
    expect((await review(people.board, id, 1, "verify")).code).toBe("SUCCESS");
    expect((await review(people.board, id, 2, "approve")).code).toBe(
      "SECOND_REVIEWER_REQUIRED"
    );
    expect((await review(people.board2, id, 2, "approve")).code).toBe(
      "SUCCESS"
    );
  });

  it("single_step: a Society Affairs manager may approve a pending application directly", async () => {
    await setPolicy("single_step");
    const { result } = await submit();
    expect(
      (
        await review(
          people.societyAffairs,
          result.applicationId as string,
          1,
          "approve"
        )
      ).code
    ).toBe("SUCCESS");
  });

  it("rejection is final, deletes the card and keeps the internal note out of audit", async () => {
    const { result } = await submit();
    const id = result.applicationId as string;
    const note = "Card photo unreadable\r\nAsked to reapply";
    expect(
      (await review(people.societyAffairs, id, 1, "reject", note)).code
    ).toBe("SUCCESS");
    const [row] =
      await admin`SELECT status::text, decision_note FROM private.membership_applications WHERE id = ${id}`;
    expect(row).toEqual({ status: "rejected", decision_note: note });
    expect(
      await admin`SELECT 1 FROM private.membership_documents WHERE application_id = ${id}`
    ).toHaveLength(0);
    for (const decision of ["verify", "approve", "reject"]) {
      expect((await review(people.board, id, 2, decision)).code).toBe(
        "INVALID_TRANSITION"
      );
    }
    const audit = await admin<{ changes: Record<string, unknown> }[]>`
      SELECT changes FROM private.uc02_audit WHERE action = 'membership.rejected' AND changes ->> 'applicationId' = ${id}`;
    expect(audit[0].changes).toMatchObject({
      hasNote: true,
      documentDeleted: true,
    });
    expect(JSON.stringify(audit)).not.toContain("unreadable");
  });

  it("rejects stale revisions and serialises concurrent decisions", async () => {
    await setPolicy("single_step");
    const { result } = await submit();
    const id = result.applicationId as string;
    expect((await review(people.board, id, 7, "approve")).code).toBe(
      "STALE_REVISION"
    );
    const outcomes = await Promise.all([
      review(people.board, id, 1, "approve"),
      review(people.board2, id, 1, "approve"),
      review(people.societyAffairs, id, 1, "reject"),
    ]);
    expect(outcomes.filter((o) => o.code === "SUCCESS")).toHaveLength(1);
    expect(outcomes.filter((o) => o.code === "STALE_REVISION")).toHaveLength(2);
  });

  it("never lets a reviewer review or open their own application", async () => {
    await setPolicy("single_step");
    const { result } = await submit({
      email: `own-${randomUUID().slice(0, 6)}@squ.edu.om`,
    });
    const id = result.applicationId as string;
    const [{ email }] = await admin<
      { email: string }[]
    >`SELECT email FROM private.membership_applications WHERE id = ${id}`;
    await admin`UPDATE auth.users SET email = ${email} WHERE id = ${people.board2}`;
    try {
      expect((await review(people.board2, id, 1, "approve")).code).toBe(
        "SELF_REVIEW"
      );
      expect(await detail(people.board2, id)).toMatchObject({
        code: "SUCCESS",
        ownApplication: true,
      });
      expect(
        await runtime`SELECT * FROM private.get_membership_document(${people.board2}, ${id})`
      ).toHaveLength(0);
    } finally {
      await admin`UPDATE auth.users SET email = ${emails.board2} WHERE id = ${people.board2}`;
    }
  });

  it("returns the card only to a reviewer, records each view, and nothing once decided", async () => {
    const { result } = await submit();
    const id = result.applicationId as string;
    const rows = await runtime<{ media_type: string; content: Buffer }[]>`
      SELECT * FROM private.get_membership_document(${people.societyAffairs}, ${id})`;
    expect(rows).toHaveLength(1);
    expect(rows[0].media_type).toBe("image/png");
    expect(Buffer.from(rows[0].content).equals(PNG)).toBe(true);
    const views = await admin<{ actor_user_id: string }[]>`
      SELECT actor_user_id FROM private.uc02_audit WHERE action = 'membership.document_viewed' AND changes ->> 'applicationId' = ${id}`;
    expect(views).toEqual([{ actor_user_id: people.societyAffairs }]);

    await review(people.board, id, 1, "reject");
    expect(
      await runtime`SELECT * FROM private.get_membership_document(${people.board}, ${id})`
    ).toHaveLength(0);
  });

  it("activates only after approval, via the applicant's own Auth identity, granting no access", async () => {
    await setPolicy("single_step");
    const { result, email, universityId, token } = await submit({
      discipline: "civil",
      year: 3,
    });
    const id = result.applicationId as string;
    expect(
      (await call(runtime, "activate_membership", [people.board, id, "none"]))
        .code
    ).toBe("INVALID_TRANSITION");
    expect((await review(people.board, id, 1, "approve")).code).toBe("SUCCESS");
    expect(
      (await call(runtime, "activate_membership", [people.board, id, "none"]))
        .code
    ).toBe("NEEDS_INVITATION");

    // What the Auth invitation does: an identity now exists for that email.
    const applicant = randomUUID();
    await admin`INSERT INTO auth.users (id, email) VALUES (${applicant}, ${email})`;
    expect(
      await call(runtime, "activate_membership", [
        people.societyAffairs,
        id,
        "sent",
      ])
    ).toEqual({
      code: "SUCCESS",
      memberId: applicant,
    });
    const [member] =
      await admin`SELECT full_name, email, university_id, year, major, status::text FROM public.members WHERE id = ${applicant}`;
    expect(member).toEqual({
      full_name: "Test Applicant",
      email,
      university_id: universityId,
      year: 3,
      major: "civil",
      status: "member",
    });
    expect(
      await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${applicant}`
    ).toHaveLength(0);
    expect(
      (await call(runtime, "activate_membership", [people.board, id, "none"]))
        .code
    ).toBe("ALREADY_ACTIVE");
    expect(
      await call(runtime, "get_membership_application_status", [token])
    ).toMatchObject({ status: "approved", activated: true });
    expect((await submit({ email })).result.code).toBe("ALREADY_MEMBER");
    expect((await submit({ universityId })).result.code).toBe("ALREADY_MEMBER");
    const [audit] = await admin<{ changes: unknown }[]>`
      SELECT changes FROM private.uc02_audit WHERE action = 'membership.activated' AND changes ->> 'applicationId' = ${id}`;
    expect(audit.changes).toEqual({
      applicationId: id,
      memberId: applicant,
      invitation: "sent",
      reviewer: "society_affairs",
    });
  });

  it("refuses to link an identity when another member already holds the student ID", async () => {
    await setPolicy("single_step");
    const first = await submit();
    await review(
      people.board,
      first.result.applicationId as string,
      1,
      "approve"
    );
    // Another member record with the same student ID appears through some other path.
    const other = randomUUID();
    await admin`INSERT INTO public.members (id, full_name, email, university_id) VALUES (${other}, 'Other', ${`other-${other.slice(0, 6)}@squ.edu.om`}, ${first.universityId})`;
    await admin`INSERT INTO auth.users (id, email) VALUES (${randomUUID()}, ${first.email})`;
    expect(
      (
        await call(runtime, "activate_membership", [
          people.board,
          first.result.applicationId,
          "sent",
        ])
      ).code
    ).toBe("CONFLICT");
  });

  it("removes authority the moment access is revoked", async () => {
    const user = randomUUID();
    await admin`INSERT INTO auth.users (id, email) VALUES (${user}, ${`sa-${user.slice(0, 6)}@example.test`})`;
    const [{ id: committee }] = await admin<
      { id: string }[]
    >`SELECT id FROM public.committees WHERE slug = 'society-affairs'`;
    await admin`INSERT INTO public.administrative_access (user_id, access_level, committee_id, granted_by)
                VALUES (${user}, 'COMMITTEE_MANAGER', ${committee}, ${people.technical})`;
    const { result } = await submit();
    const id = result.applicationId as string;
    expect((await detail(user, id)).code).toBe("SUCCESS");
    await admin`UPDATE public.administrative_access SET revoked_at = now(), revoked_by = ${people.technical} WHERE user_id = ${user}`;
    expect((await review(user, id, await revisionOf(id), "verify")).code).toBe(
      "FORBIDDEN"
    );
    expect((await detail(user, id)).code).toBe("FORBIDDEN");
  });

  it("lists by status and search for reviewers, oldest first, with pagination", async () => {
    const marker = `Listing ${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 3; i += 1) await submit({ fullName: `${marker} ${i}` });
    const page = await runtime<
      { full_name: string; id: string; cursor_at: string }[]
    >`
      SELECT * FROM private.list_membership_applications(${people.board}, 'pending_review', ${marker}, NULL, NULL, 2)`;
    expect(page.map((r) => r.full_name)).toEqual([
      `${marker} 0`,
      `${marker} 1`,
    ]);
    expect(page[1].cursor_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
    );
    // The cursor goes back exactly as the routine returned it.
    const next = await runtime<{ full_name: string }[]>`
      SELECT * FROM private.list_membership_applications(${people.board}, 'pending_review', ${marker}, ${page[1].cursor_at}::text::timestamptz, ${page[1].id}, 2)`;
    expect(next.map((r) => r.full_name)).toEqual([`${marker} 2`]);
    const wildcard =
      await runtime`SELECT * FROM private.list_membership_applications(${people.board}, 'all', '%', NULL, NULL, 5)`;
    expect(wildcard).toHaveLength(0);
  });

  it("gives runtime and browser roles no direct access to membership data", async () => {
    for (const table of [
      "membership_applications",
      "membership_documents",
      "membership_submission_attempts",
      "membership_settings",
    ]) {
      await expect(
        runtime.unsafe(`SELECT * FROM private.${table}`)
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(runtime`SELECT * FROM public.members`).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      runtime`SELECT private.membership_reviewer_kind(${people.board}, false)`
    ).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "authenticated"]) {
      const [{ allowed }] = await admin<{ allowed: boolean }[]>`
        SELECT has_function_privilege(${role}, 'private.review_membership_application(uuid, uuid, integer, text, text)', 'EXECUTE') AS allowed`;
      expect(allowed, role).toBe(false);
    }
  });
});
