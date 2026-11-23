import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  CONSENT_VERSIONS,
  CURRENT_CONSENT_VERSION,
  MAX_INTERESTS,
  MEMBERSHIP_DISCIPLINES,
  MEMBERSHIP_INTERESTS,
} from "../../lib/membership/types";
import { adminDb, close, runtimeDb } from "./helpers";

// Development Cycle 2 (ADR 0025, migration 0033) under the real restricted roles: expanded
// membership, SQU student verification, teams and leadership appointments.
describe("development cycle 2 (0033, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const runtime2 = runtimeDb();
  afterAll(async () => {
    // Global settings other suites rely on go back to their defaults.
    await admin`UPDATE private.verification_settings SET squ_submissions_per_30_days = 3,
      document_retention_days = NULL, leadership_requests_per_30_days = 5,
      max_active_appointments_per_member = NULL, updated_by = NULL, updated_at = NULL`;
    await admin`UPDATE private.organizational_positions SET max_holders_per_team = 1`;
    await admin`UPDATE private.membership_settings SET approval_policy = NULL`;
    await close(admin, runtime, runtime2);
  });

  let seq = 0;
  const ip = () => `198.33.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  const tag = () => randomBytes(4).toString("hex");
  const studentNumber = () =>
    String(10_000_000 + Math.floor(Math.random() * 89_999_999));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Result = Record<string, any>;
  async function call(fn: string, values: unknown[], db: Sql = runtime) {
    const rows = await db.unsafe(
      `SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return rows[0].result as Result;
  }
  async function user(email = `u.${tag()}@example.org`) {
    const id = randomUUID();
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${email},now())`;
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
  async function member(
    options: {
      id?: string;
      category?: string | null;
      year?: number | null;
    } = {}
  ) {
    const email = `m.${tag()}@example.org`;
    const id = options.id ?? (await user(email));
    await admin`INSERT INTO public.members(id,full_name,email,year,major,category)
      VALUES(${id},${`Synthetic ${tag()}`},${email},${options.year ?? null},'civil',
        ${options.category === undefined ? "industry_professional" : options.category})`;
    return id;
  }
  async function committee() {
    const id = randomUUID();
    const slug = `dc2-${tag()}`;
    await admin`INSERT INTO public.committees(id,name,slug) VALUES(${id},${`DC2 ${slug}`},${slug})`;
    return id;
  }
  const people: Record<
    "technical" | "board" | "affairs" | "manager" | "outsider",
    string
  > = {} as never;
  beforeAll(async () => {
    const [affairs] =
      await admin`SELECT id FROM public.committees WHERE slug = 'society-affairs'`;
    people.technical = await withAccess("TECHNICAL");
    people.board = await withAccess("BOARD_ADMIN");
    people.affairs = await withAccess("COMMITTEE_MANAGER", affairs.id);
    people.manager = await withAccess("COMMITTEE_MANAGER", await committee());
    people.outsider = await user();
    await admin`UPDATE private.membership_settings SET approval_policy = 'single_step'`;
  });
  async function team(committeeId: string, name = `Team ${tag()}`) {
    const result = await call("admin_create_team", [
      people.board,
      committeeId,
      name,
      null,
      null,
      null,
    ]);
    expect(result.code).toBe("SUCCESS");
    return result.id as string;
  }

  // ------------------------------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------------------------------
  function apply(input: {
    email?: string;
    category?: string;
    institution?: string | null;
    institutionName?: string | null;
    year?: number | null;
    consent?: string;
    address?: string;
  }) {
    return call("submit_membership_application_v2", [
      "Synthetic Applicant",
      input.email ?? `a.${tag()}@gmail.com`,
      input.category ?? "industry_professional",
      input.institution ?? null,
      input.institutionName ?? null,
      input.year ?? null,
      "electrical",
      ["data"],
      input.consent ?? "2026-11-v2",
      randomBytes(32).toString("hex"),
      input.address ?? ip(),
    ]);
  }

  it("publishes the categories and institutions the website's form is built from", async () => {
    const options = await call("get_membership_options", []);
    expect(options.code).toBe("SUCCESS");
    expect(options.consentVersion).toBe("2026-11-v2");
    expect(options.categories.map((c: Result) => c.id)).toEqual([
      "university_student",
      "graduate",
      "academic",
      "industry_professional",
      "other",
    ]);
    expect(options.categories[0]).toEqual({
      id: "university_student",
      label: { en: "University Student", ar: "طالب جامعي" },
      institution: "required",
      academicYear: true,
    });
    expect(options.categories[1]).toMatchObject({
      institution: "optional",
      academicYear: false,
    });
    expect(options.institutions.map((i: Result) => i.id)).toEqual(
      expect.arrayContaining([
        "squ",
        "utas",
        "unizwa",
        "gutech",
        "sohar-university",
      ])
    );
    expect(options.institutions[0]).toEqual({
      id: "squ",
      name: {
        en: "Sultan Qaboos University (SQU)",
        ar: "جامعة السلطان قابوس",
      },
      country: "OM",
    });
  });

  it("agrees with Core's consent versions, disciplines and interests", async () => {
    for (const consent of CONSENT_VERSIONS)
      expect((await apply({ consent })).code, consent).toBe("SUCCESS");
    for (const discipline of MEMBERSHIP_DISCIPLINES) {
      const result = await call("submit_membership_application_v2", [
        "Synthetic Applicant",
        `d.${tag()}@example.org`,
        "other",
        null,
        null,
        null,
        discipline,
        MEMBERSHIP_INTERESTS.slice(0, MAX_INTERESTS),
        CURRENT_CONSENT_VERSION,
        randomBytes(32).toString("hex"),
        ip(),
      ]);
      expect(result.code, discipline).toBe("SUCCESS");
    }
  });

  it("accepts non-SQU applicants with a personal email and no document or student ID", async () => {
    const result = await apply({ category: "industry_professional" });
    expect(result.code).toBe("SUCCESS");
    const [row] =
      await admin`SELECT category, institution_id, institution_name, university_id, academic_year
        FROM private.membership_applications WHERE id = ${result.applicationId}`;
    expect(row).toEqual({
      category: "industry_professional",
      institution_id: null,
      institution_name: null,
      university_id: null,
      academic_year: null,
    });
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM private.membership_documents WHERE application_id = ${result.applicationId}`;
    expect(n).toBe(0);
    const [audit] =
      await admin`SELECT actor_kind, changes FROM private.uc02_audit
        WHERE action = 'membership.submitted' AND changes ->> 'applicationId' = ${result.applicationId}`;
    expect(audit).toEqual({
      actor_kind: "anonymous",
      changes: {
        applicationId: result.applicationId,
        category: "industry_professional",
      },
    });
  });

  it("validates student, graduate and other details by category, refusing values that do not apply", async () => {
    const field = async (input: Parameters<typeof apply>[0]) => {
      const result = await apply(input);
      return result.code === "SUCCESS" ? "SUCCESS" : result.field;
    };
    const student = "university_student";
    expect(await field({ category: student, year: 2 })).toBe("institution");
    expect(await field({ category: student, institution: "utas" })).toBe(
      "academicYear"
    );
    expect(
      await field({ category: student, institution: "utas", year: 6 })
    ).toBe("academicYear");
    expect(
      await field({ category: student, institution: "utas", year: 3 })
    ).toBe("SUCCESS");
    expect(
      await field({
        category: student,
        institutionName: "Imperial College London",
        year: 1,
      })
    ).toBe("SUCCESS");
    expect(
      await field({
        category: student,
        institution: "squ",
        institutionName: "Also typed",
        year: 1,
      })
    ).toBe("institution");
    expect(
      await field({ category: student, institution: "mit", year: 1 })
    ).toBe("institution");
    expect(
      await field({ category: student, institutionName: "X", year: 1 })
    ).toBe("institutionName");
    expect(await field({ category: "graduate" })).toBe("SUCCESS");
    expect(await field({ category: "graduate", institution: "squ" })).toBe(
      "SUCCESS"
    );
    expect(
      await field({ category: "graduate", institution: "squ", year: 4 })
    ).toBe("academicYear");
    expect(await field({ category: "academic", institution: "squ" })).toBe(
      "institution"
    );
    expect(await field({ category: "other", year: 2 })).toBe("academicYear");
    expect(await field({ category: "astronaut" })).toBe("category");
    expect(await field({ email: "not-an-email" })).toBe("email");
    expect(await field({ consent: "2026-01-v0" })).toBe("consent");
    // The previous website's wording stays accepted during a release.
    expect(await field({ consent: "2026-10-v1" })).toBe("SUCCESS");
  });

  it("keeps the duplicate rules and the per-address limit", async () => {
    const email = `dup.${tag()}@outlook.com`;
    expect((await apply({ email })).code).toBe("SUCCESS");
    expect((await apply({ email: email.toUpperCase() })).code).toBe(
      "ALREADY_APPLIED"
    );
    const memberId = await member();
    const [{ email: memberEmail }] =
      await admin`SELECT email FROM public.members WHERE id = ${memberId}`;
    expect((await apply({ email: memberEmail })).code).toBe("ALREADY_MEMBER");
    const address = ip();
    for (let i = 0; i < 5; i += 1)
      expect((await apply({ address })).code).toBe("SUCCESS");
    expect((await apply({ address })).code).toBe("RATE_LIMITED");
  });

  it("approves and activates a graduate with a typed alma mater, with no SQU verification", async () => {
    const email = `grad.${tag()}@gmail.com`;
    const submitted = await apply({
      email,
      category: "graduate",
      institutionName: "University of Leeds",
    });
    expect(submitted.code).toBe("SUCCESS");
    const detail = await call("get_membership_application", [
      people.affairs,
      submitted.applicationId,
    ]);
    expect(detail.application).toMatchObject({
      email,
      universityId: null,
      academicYear: null,
      category: "graduate",
      categoryLabel: { en: "Graduate / Alumni" },
      institution: null,
      institutionName: "University of Leeds",
      document: null,
    });
    const list =
      await runtime`SELECT category, institution FROM private.list_membership_applications(${people.affairs}::uuid, 'all', ${email}, NULL, NULL, 10)`;
    expect(list).toEqual([
      { category: "graduate", institution: "University of Leeds" },
    ]);
    const approved = await call("review_membership_application", [
      people.affairs,
      submitted.applicationId,
      1,
      "approve",
      null,
    ]);
    expect(approved.code).toBe("SUCCESS");
    const account = await user(email);
    const activated = await call("activate_membership", [
      people.affairs,
      submitted.applicationId,
      "none",
    ]);
    expect(activated).toEqual({ code: "SUCCESS", memberId: account });
    const [row] =
      await admin`SELECT category, institution_id, institution_name, university_id, year, status
        FROM public.members WHERE id = ${account}`;
    expect(row).toEqual({
      category: "graduate",
      institution_id: null,
      institution_name: "University of Leeds",
      university_id: null,
      year: null,
      status: "member",
    });
    const profile = await call("get_own_profile", [account]);
    expect(profile).toMatchObject({
      code: "SUCCESS",
      category: "graduate",
      institutionName: "University of Leeds",
      universityId: null,
      squVerified: false,
    });
    expect((await call("get_own_squ_verification", [account])).status).toBe(
      "not_verified"
    );
  });

  // ------------------------------------------------------------------------------------------
  // Legacy records
  // ------------------------------------------------------------------------------------------
  it("backfills legacy SQU records by rule, leaves others unrecorded, and verifies nobody", async () => {
    const student = process.env.UC02_TEST_LEGACY_STUDENT_ID!;
    const graduate = process.env.UC02_TEST_LEGACY_GRADUATE_ID!;
    const other = process.env.UC02_TEST_LEGACY_OTHER_ID!;
    const application = process.env.UC02_TEST_LEGACY_APPLICATION_ID!;
    const rows =
      await admin`SELECT id, category, institution_id, university_id, year FROM public.members
        WHERE id IN (${student}, ${graduate}, ${other}) ORDER BY full_name`;
    expect(rows).toEqual([
      {
        id: other,
        category: null,
        institution_id: null,
        university_id: "20170123",
        year: 2,
      },
      {
        id: graduate,
        category: "graduate",
        institution_id: "squ",
        university_id: "20150123",
        year: 5,
      },
      {
        id: student,
        category: "university_student",
        institution_id: "squ",
        university_id: "20190123",
        year: 3,
      },
    ]);
    const [app] =
      await admin`SELECT category, institution_id, university_id FROM private.membership_applications WHERE id = ${application}`;
    expect(app).toEqual({
      category: "university_student",
      institution_id: "squ",
      university_id: "20200123",
    });
    // Its previously uploaded ID card is untouched and counts for nothing here.
    const [{ cards }] =
      await admin`SELECT count(*)::int AS cards FROM private.membership_documents WHERE application_id = ${application}`;
    expect(cards).toBe(1);
    const [{ verified }] =
      await admin`SELECT count(*)::int AS verified FROM private.squ_verifications WHERE member_id IN (${student}, ${graduate}, ${other})`;
    expect(verified).toBe(0);
  });

  it("keeps legacy member records usable through the old and new profile routines", async () => {
    const student = process.env.UC02_TEST_LEGACY_STUDENT_ID!;
    const profile = await call("get_own_profile", [student]);
    expect(profile).toMatchObject({
      code: "SUCCESS",
      universityId: "20190123",
      academicYear: 3,
      category: "university_student",
      institution: { id: "squ", en: "Sultan Qaboos University (SQU)" },
      squVerified: false,
    });
    expect(await call("get_own_squ_verification", [student])).toMatchObject({
      status: "not_verified",
      canSubmit: true,
    });
    // The previous Core's routine still works for an SQU student.
    expect(
      (await call("update_own_profile", [student, null, 4, "civil", ["cad"]]))
        .code
    ).toBe("SUCCESS");
    const other = process.env.UC02_TEST_LEGACY_OTHER_ID!;
    const updated = await call("update_own_profile_v2", [
      other,
      null,
      "academic",
      null,
      null,
      null,
      "mechanical",
      [],
    ]);
    expect(updated).toMatchObject({
      code: "SUCCESS",
      category: "academic",
      academicYear: null,
      universityId: "20170123",
    });
    // A category whose details are incomplete is refused, not half-saved.
    expect(
      (
        await call("update_own_profile_v2", [
          other,
          null,
          "university_student",
          null,
          null,
          2,
          "mechanical",
          [],
        ])
      ).field
    ).toBe("institution");
  });

  // ------------------------------------------------------------------------------------------
  // SQU student verification
  // ------------------------------------------------------------------------------------------
  function card() {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      randomBytes(32),
    ]);
    return { bytes, sha: createHash("sha256").update(bytes).digest("hex") };
  }
  async function submitSqu(memberId: string, number = studentNumber()) {
    const c = card();
    return call("submit_squ_verification", [
      memberId,
      number,
      "image/jpeg",
      c.sha,
      c.bytes.length,
      c.bytes,
      null,
      null,
    ]);
  }
  const decideSqu = (
    actor: string,
    request: string,
    revision: number,
    decision: "approve" | "reject",
    reason: string | null = null,
    note: string | null = null
  ) =>
    call("decide_squ_verification", [
      actor,
      request,
      revision,
      decision,
      reason,
      note,
    ]);

  it("runs SQU verification independently of membership, with rejection, resubmission and revocation kept as history", async () => {
    const m = await member({ category: "university_student", year: 2 });
    await admin`UPDATE public.members SET institution_id = 'squ' WHERE id = ${m}`;
    const [before] =
      await admin`SELECT status, category, created_at FROM public.members WHERE id = ${m}`;
    expect((await call("begin_squ_verification", [m])).code).toBe("SUCCESS");
    const number = studentNumber();
    const first = await submitSqu(m, number);
    expect(first.code).toBe("SUCCESS");
    // The answer is the SQU card's own state, nothing about leadership.
    expect(first).not.toHaveProperty("appointments");
    expect(first).toMatchObject({
      status: "pending",
      studentNumber: `•••${number.slice(-3)}`,
    });
    expect(JSON.stringify(first)).not.toContain(number);
    expect((await submitSqu(m)).code).toBe("ALREADY_PENDING");
    expect((await call("begin_squ_verification", [m])).code).toBe(
      "ALREADY_PENDING"
    );

    // Reviewers see the full number; the reason is required to reject.
    const detail = await call("get_squ_verification", [
      people.affairs,
      first.requestId,
    ]);
    expect(detail.request).toMatchObject({
      studentNumber: number,
      state: "pending",
      document: { mediaType: "image/jpeg" },
    });
    expect(
      (await decideSqu(people.affairs, first.requestId, 1, "reject")).field
    ).toBe("rejectionReason");
    expect(
      (
        await decideSqu(
          people.affairs,
          first.requestId,
          1,
          "reject",
          "The card photo is blurred.",
          "Internal: second blurred upload from this device."
        )
      ).code
    ).toBe("SUCCESS");
    // The same decision again creates nothing.
    expect(
      (await decideSqu(people.board, first.requestId, 1, "approve")).code
    ).toBe("STALE_REVISION");
    expect(
      (await decideSqu(people.board, first.requestId, 2, "approve")).code
    ).toBe("INVALID_TRANSITION");
    const rejected = await call("get_own_squ_verification", [m]);
    expect(rejected).toMatchObject({
      status: "rejected",
      rejectionReason: "The card photo is blurred.",
      canSubmit: true,
    });
    expect(JSON.stringify(rejected)).not.toContain("Internal:");

    const second = await submitSqu(m, number);
    expect(second.code).toBe("SUCCESS");
    expect(
      (await decideSqu(people.board, second.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    expect((await call("get_own_profile", [m])).squVerified).toBe(true);
    expect(await call("get_own_squ_verification", [m])).toMatchObject({
      status: "verified",
      canSubmit: false,
    });
    expect((await call("begin_squ_verification", [m])).code).toBe(
      "ALREADY_VERIFIED"
    );
    // Verification changed nothing about membership.
    const [after] =
      await admin`SELECT status, category, created_at FROM public.members WHERE id = ${m}`;
    expect(after).toEqual(before);
    const [verification] =
      await admin`SELECT id, verified_by FROM private.squ_verifications WHERE member_id = ${m}`;
    expect(verification.verified_by).toBe(people.board);

    expect(
      (
        await call("revoke_squ_verification", [
          people.affairs,
          verification.id,
          "",
          null,
        ])
      ).field
    ).toBe("reason");
    expect(
      (
        await call("revoke_squ_verification", [
          people.affairs,
          verification.id,
          "You are no longer enrolled at SQU.",
          "Registrar confirmation on file.",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("revoke_squ_verification", [
          people.affairs,
          verification.id,
          "Again",
          null,
        ])
      ).code
    ).toBe("INVALID_TRANSITION");
    const revoked = await call("get_own_squ_verification", [m]);
    expect(revoked).toMatchObject({
      status: "revoked",
      revocationReason: "You are no longer enrolled at SQU.",
      canSubmit: true,
    });
    expect((await call("get_own_profile", [m])).squVerified).toBe(false);

    // Three submissions in 30 days is the default limit.
    const third = await submitSqu(m);
    expect(third.code).toBe("SUCCESS");
    expect(
      (
        await decideSqu(
          people.board,
          third.requestId,
          1,
          "reject",
          "Wrong card."
        )
      ).code
    ).toBe("SUCCESS");
    expect((await call("begin_squ_verification", [m])).code).toBe(
      "RATE_LIMITED"
    );
    expect((await submitSqu(m)).code).toBe("RATE_LIMITED");
    const limited = await call("get_own_squ_verification", [m]);
    expect(limited.canSubmit).toBe(false);
    expect(limited.nextSubmissionAt).not.toBeNull();

    const history =
      await admin`SELECT status FROM private.squ_verification_requests WHERE member_id = ${m} ORDER BY submitted_at`;
    expect(history.map((r) => r.status)).toEqual([
      "rejected",
      "approved",
      "rejected",
    ]);
    const [kept] =
      await admin`SELECT revoked_at IS NOT NULL AS revoked, revocation_note FROM private.squ_verifications WHERE id = ${verification.id}`;
    expect(kept).toEqual({
      revoked: true,
      revocation_note: "Registrar confirmation on file.",
    });
    const actions =
      await admin`SELECT action FROM private.uc02_audit WHERE changes ->> 'memberId' = ${m} AND action LIKE 'verification.%' ORDER BY occurred_at, id`;
    expect(actions.map((a) => a.action)).toEqual([
      "verification.submitted",
      "verification.rejected",
      "verification.submitted",
      "verification.approved",
      "verification.revoked",
      "verification.submitted",
      "verification.rejected",
    ]);
  });

  it("keeps verification requests and evidence away from everyone but Board and Society Affairs", async () => {
    const m = await member();
    const submitted = await submitSqu(m);
    // Technical reviews membership applications but, by its access alone, not SQU evidence.
    for (const actor of [
      people.technical,
      people.manager,
      people.outsider,
      m,
    ]) {
      expect(
        (await call("get_squ_verification", [actor, submitted.requestId])).code
      ).toBe("FORBIDDEN");
      expect(
        (
          await call("list_squ_verifications", [
            actor,
            "all",
            null,
            null,
            null,
            0,
          ])
        ).code
      ).toBe("FORBIDDEN");
      const document =
        await runtime`SELECT * FROM private.get_squ_verification_document(${actor}::uuid, ${submitted.requestId}::uuid)`;
      expect(document).toHaveLength(0);
      expect(
        (await decideSqu(actor, submitted.requestId, 1, "approve")).code
      ).toBe("FORBIDDEN");
    }
    // Another member's own view never includes this request.
    const other = await member();
    for (const own of ["get_own_squ_verification", "get_own_leadership"])
      expect(JSON.stringify(await call(own, [other]))).not.toContain(
        submitted.requestId
      );
    // A reviewer reads the evidence, and the view is audited.
    const document =
      await runtime`SELECT media_type, byte_size FROM private.get_squ_verification_document(${people.affairs}::uuid, ${submitted.requestId}::uuid)`;
    expect(document).toEqual([{ media_type: "image/jpeg", byte_size: 36 }]);
    const [{ views }] =
      await admin`SELECT count(*)::int AS views FROM private.uc02_audit WHERE action = 'verification.document_viewed'
        AND changes ->> 'requestId' = ${submitted.requestId} AND actor_user_id = ${people.affairs}`;
    expect(views).toBe(1);
    const [{ email }] =
      await admin`SELECT email FROM public.members WHERE id = ${m}`;
    const listed = await call("list_squ_verifications", [
      people.affairs,
      "pending",
      email,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
      0,
    ]);
    expect(listed.total).toBe(1);
    expect(listed.items[0]).toMatchObject({
      id: submitted.requestId,
      state: "pending",
      hasDocument: true,
    });
    // No item in a list carries a student number.
    expect(JSON.stringify(listed)).not.toMatch(/studentNumber/);
    // The runtime role reaches none of the tables directly.
    for (const table of [
      "squ_verification_requests",
      "squ_verification_documents",
      "squ_verifications",
      "leadership_requests",
      "leadership_appointments",
      "committee_teams",
      "verification_settings",
    ])
      await expect(
        runtime.unsafe(`SELECT 1 FROM private.${table} LIMIT 1`)
      ).rejects.toThrow(/permission denied/);
  });

  it("refuses self-review and verifies a student number for one member at a time", async () => {
    // A reviewer who is also a member never decides their own evidence.
    await member({ id: people.affairs });
    const own = await submitSqu(people.affairs);
    expect(own.code).toBe("SUCCESS");
    expect(
      (await decideSqu(people.affairs, own.requestId, 1, "approve")).code
    ).toBe("SELF_REVIEW");
    const ownDocument =
      await runtime`SELECT * FROM private.get_squ_verification_document(${people.affairs}::uuid, ${own.requestId}::uuid)`;
    expect(ownDocument).toHaveLength(0);
    expect(
      (await decideSqu(people.board, own.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    const [{ id: verification }] =
      await admin`SELECT id FROM private.squ_verifications WHERE member_id = ${people.affairs}`;
    expect(
      (
        await call("revoke_squ_verification", [
          people.affairs,
          verification,
          "Self",
          null,
        ])
      ).code
    ).toBe("SELF_REVIEW");

    const number = studentNumber();
    const a = await submitSqu(await member(), number);
    const b = await submitSqu(await member(), number);
    expect(
      (await decideSqu(people.board, a.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    expect(
      (await decideSqu(people.board, b.requestId, 1, "approve")).code
    ).toBe("STUDENT_NUMBER_IN_USE");
    const [{ status }] =
      await admin`SELECT status FROM private.squ_verification_requests WHERE id = ${b.requestId}`;
    expect(status).toBe("pending");
  });

  it("only lets members submit evidence, and validates it", async () => {
    const applicant = await user();
    expect((await call("begin_squ_verification", [applicant])).code).toBe(
      "MEMBER_REQUIRED"
    );
    expect((await submitSqu(applicant)).code).toBe("MEMBER_REQUIRED");
    const m = await member();
    expect((await submitSqu(m, "12ab")).field).toBe("studentNumber");
    const c = card();
    const wrongHash = await call("submit_squ_verification", [
      m,
      studentNumber(),
      "image/jpeg",
      "0".repeat(64),
      c.bytes.length,
      c.bytes,
      null,
      null,
    ]);
    expect(wrongHash.field).toBe("document");
    const both = await call("submit_squ_verification", [
      m,
      studentNumber(),
      "image/jpeg",
      c.sha,
      c.bytes.length,
      c.bytes,
      "v1",
      `squ-verification/${randomUUID()}.jpg`,
    ]);
    expect(both.field).toBe("document");
    const wrongPrefix = await call("submit_squ_verification", [
      m,
      studentNumber(),
      "image/jpeg",
      c.sha,
      c.bytes.length,
      null,
      "v1",
      `membership-id-cards/${randomUUID()}.jpg`,
    ]);
    expect(wrongPrefix.field).toBe("document");
  });

  it("stores evidence in Storage by reference and never queues a referenced object", async () => {
    const m = await member();
    const c = card();
    const key = `squ-verification/${randomUUID()}.jpg`;
    const stored = await call("submit_squ_verification", [
      m,
      studentNumber(),
      "image/jpeg",
      c.sha,
      c.bytes.length,
      null,
      "v1",
      key,
    ]);
    expect(stored.code).toBe("SUCCESS");
    expect(
      (await call("queue_abandoned_verification_upload", ["v1", key])).code
    ).toBe("REFERENCED");
    expect(
      (
        await call("queue_abandoned_verification_upload", [
          "v1",
          `membership-id-cards/${randomUUID()}.jpg`,
        ])
      ).code
    ).toBe("VALIDATION_ERROR");
    const orphan = `squ-verification/${randomUUID()}.png`;
    expect(
      (await call("queue_abandoned_verification_upload", ["v1", orphan])).code
    ).toBe("SUCCESS");
    // Even a forged queue entry for the referenced object is never handed out.
    await admin`INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason)
      VALUES ('v1', ${key}, 'upload_abandoned')`;
    const claimed =
      await runtime`SELECT object_key FROM private.claim_membership_storage_deletions(50)`;
    const keys = claimed.map((row) => row.object_key);
    expect(keys).toContain(orphan);
    expect(keys).not.toContain(key);
    const [document] =
      await runtime`SELECT content, storage_key FROM private.get_squ_verification_document(${people.board}::uuid, ${stored.requestId}::uuid)`;
    expect(document).toEqual({ content: null, storage_key: key });
  });

  it("keeps evidence until a retention period is configured, then purges only decided requests", async () => {
    expect(
      await call("purge_expired_verification_documents", [people.affairs, 50])
    ).toEqual({ code: "DISABLED", purged: 0 });
    expect(
      (await call("purge_expired_verification_documents", [people.manager, 50]))
        .code
    ).toBe("FORBIDDEN");
    expect(
      // Without settings.verification (ADR 0027): a Committee Manager of another committee.
      (
        await call("set_verification_settings", [
          people.manager,
          3,
          30,
          5,
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("set_verification_settings", [
          people.technical,
          3,
          5,
          5,
          null,
        ])
      ).field
    ).toBe("documentRetentionDays");
    expect(
      (
        await call("set_verification_settings", [
          people.technical,
          3,
          30,
          5,
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    const decided = await submitSqu(await member());
    await decideSqu(people.board, decided.requestId, 1, "reject", "Unreadable");
    const pending = await submitSqu(await member());
    const c = card();
    const storedMember = await member();
    const key = `squ-verification/${randomUUID()}.jpg`;
    const stored = await call("submit_squ_verification", [
      storedMember,
      studentNumber(),
      "image/jpeg",
      c.sha,
      c.bytes.length,
      null,
      "v1",
      key,
    ]);
    await decideSqu(people.board, stored.requestId, 1, "approve");
    await admin`UPDATE private.squ_verification_requests
      SET submitted_at = now() - interval '45 days',
          decided_at = CASE WHEN status <> 'pending' THEN now() - interval '40 days' END
      WHERE id IN (${decided.requestId}, ${pending.requestId}, ${stored.requestId})`;
    const purged = await call("purge_expired_verification_documents", [
      people.affairs,
      100,
    ]);
    expect(purged.code).toBe("SUCCESS");
    expect(purged.purged).toBeGreaterThanOrEqual(2);
    const left =
      await admin`SELECT request_id FROM private.squ_verification_documents
        WHERE request_id IN (${decided.requestId}, ${pending.requestId}, ${stored.requestId})`;
    expect(left.map((r) => r.request_id)).toEqual([pending.requestId]);
    const [request] =
      await admin`SELECT document_deleted_at IS NOT NULL AS deleted FROM private.squ_verification_requests WHERE id = ${decided.requestId}`;
    expect(request.deleted).toBe(true);
    const [queued] =
      await admin`SELECT reason FROM private.membership_storage_deletions WHERE storage_key = ${key}`;
    expect(queued.reason).toBe("document_removed");
    // The verification itself is untouched by the cleanup.
    expect(
      (await call("get_own_squ_verification", [storedMember])).status
    ).toBe("verified");
    // Technical sets the period but, as a non-reviewer, never runs the cleanup itself.
    expect(
      (
        await call("purge_expired_verification_documents", [
          people.technical,
          50,
        ])
      ).code
    ).toBe("FORBIDDEN");
  });

  // ------------------------------------------------------------------------------------------
  // Teams
  // ------------------------------------------------------------------------------------------
  it("lets only senior administrators manage teams, with names unique per committee", async () => {
    const c = await committee();
    expect(
      (
        await call("admin_create_team", [
          people.affairs,
          c,
          "Development",
          null,
          null,
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    const created = await call("admin_create_team", [
      people.board,
      c,
      "Development",
      "فريق التطوير",
      "Builds the platform.",
      null,
    ]);
    expect(created.code).toBe("SUCCESS");
    expect(
      (
        await call("admin_create_team", [
          people.technical,
          c,
          "DEVELOPMENT",
          null,
          null,
          null,
        ])
      ).code
    ).toBe("NAME_TAKEN");
    expect(
      (
        await call("admin_create_team", [
          people.board,
          c,
          "X",
          null,
          null,
          null,
        ])
      ).field
    ).toBe("nameEn");
    expect(
      (
        await call("admin_update_team", [
          people.board,
          created.id,
          "Development",
          "فريق التطوير",
          "Builds the platform.",
          null,
        ])
      ).code
    ).toBe("UNCHANGED");
    expect(
      (
        await call("admin_update_team", [
          people.board,
          created.id,
          "Development",
          "فريق التطوير",
          "Builds and runs the platform.",
          "يبني المنصة.",
        ])
      ).code
    ).toBe("SUCCESS");
    const listed = await call("admin_list_committee_teams", [people.board, c]);
    expect(listed.teams).toEqual([
      expect.objectContaining({
        id: created.id,
        name: { en: "Development", ar: "فريق التطوير" },
        description: {
          en: "Builds and runs the platform.",
          ar: "يبني المنصة.",
        },
        status: "active",
        leaders: [],
        inUse: false,
      }),
    ]);
    expect(listed.positions.map((p: Result) => p.id)).toEqual([
      "chief",
      "assistant_chief",
    ]);
    expect(
      (await call("admin_list_committee_teams", [people.manager, c])).code
    ).toBe("FORBIDDEN");
    await admin`UPDATE public.committees SET archived_at = now() WHERE id = ${c}`;
    expect(
      (
        await call("admin_create_team", [
          people.board,
          c,
          "Late",
          null,
          null,
          null,
        ])
      ).code
    ).toBe("COMMITTEE_ARCHIVED");
  });

  // ------------------------------------------------------------------------------------------
  // Leadership
  // ------------------------------------------------------------------------------------------
  const requestLeadership = (
    m: string,
    committeeId: string,
    teamId: string,
    position = "chief",
    db: Sql = runtime
  ) => call("request_leadership", [m, committeeId, teamId, position], db);
  const decideLeadership = (
    actor: string,
    request: string,
    revision: number,
    decision: "approve" | "reject",
    reason: string | null = null,
    db: Sql = runtime
  ) =>
    call(
      "decide_leadership_request",
      [actor, request, revision, decision, reason, null],
      db
    );

  it("validates the committee → team → position hierarchy on the server", async () => {
    const a = await committee();
    const b = await committee();
    const ta = await team(a);
    const tb = await team(b);
    const inactive = await team(a);
    expect(
      (
        await call("admin_set_team_status", [
          people.board,
          inactive,
          "inactive",
        ])
      ).code
    ).toBe("SUCCESS");
    const m = await member();
    expect((await requestLeadership(m, a, tb)).code).toBe("HIERARCHY_MISMATCH");
    expect((await requestLeadership(m, a, inactive)).code).toBe(
      "TEAM_INACTIVE"
    );
    expect((await requestLeadership(m, a, ta, "emperor")).field).toBe(
      "position"
    );
    expect((await requestLeadership(m, randomUUID(), ta)).code).toBe(
      "NOT_FOUND"
    );
    expect((await requestLeadership(await user(), a, ta)).code).toBe(
      "MEMBER_REQUIRED"
    );
    const options = await call("get_leadership_options", [m]);
    const offered = options.committees.find((c: Result) => c.id === a);
    expect(offered.teams.map((t: Result) => t.id)).toEqual([ta]);
    expect(options.positions.map((p: Result) => p.id)).toEqual([
      "chief",
      "assistant_chief",
    ]);
    await admin`UPDATE public.committees SET archived_at = now() WHERE id = ${b}`;
    expect((await requestLeadership(m, b, tb)).code).toBe("COMMITTEE_ARCHIVED");
    expect(
      (await call("get_leadership_options", [m])).committees.some(
        (c: Result) => c.id === b
      )
    ).toBe(false);
  });

  it("decides requests with history, never granting dashboard access, and lets leadership reviewers change or revoke appointments", async () => {
    const c = await committee();
    const t = await team(c);
    const m = await member();
    const first = await requestLeadership(m, c, t);
    expect(first.code).toBe("SUCCESS");
    expect((await requestLeadership(m, c, t, "assistant_chief")).code).toBe(
      "ALREADY_PENDING"
    );
    expect(
      (await decideLeadership(people.board, first.requestId, 1, "reject")).field
    ).toBe("rejectionReason");
    expect(
      (
        await decideLeadership(
          people.board,
          first.requestId,
          1,
          "reject",
          "Elections for this team happen in January."
        )
      ).code
    ).toBe("SUCCESS");
    expect(
      (await decideLeadership(people.board, first.requestId, 2, "approve")).code
    ).toBe("INVALID_TRANSITION");
    const afterReject = await call("get_own_leadership", [m]);
    expect(afterReject.requests[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "Elections for this team happen in January.",
      position: { id: "chief" },
    });

    const second = await requestLeadership(m, c, t);
    expect(second.code).toBe("SUCCESS");
    const approved = await decideLeadership(
      people.affairs,
      second.requestId,
      1,
      "approve"
    );
    expect(approved.code).toBe("SUCCESS");
    const roles = await call("get_own_leadership", [m]);
    // The answer is the leadership card's own state, nothing about SQU verification.
    expect(roles).not.toHaveProperty("status");
    expect(roles.appointments).toEqual([
      expect.objectContaining({
        active: true,
        committee: expect.objectContaining({ id: c }),
        team: expect.objectContaining({ id: t }),
        position: {
          id: "chief",
          label: { en: "Chief", ar: "رئيس" },
        },
      }),
    ]);
    // Leadership is not dashboard access, in any form.
    expect(roles.dashboardAccess).toBe(false);
    const [{ grants }] =
      await admin`SELECT count(*)::int AS grants FROM public.administrative_access WHERE user_id = ${m}`;
    expect(grants).toBe(0);
    expect(await call("can_review_membership", [m])).toBe(false);
    expect((await call("admin_overview", [m])).code).toBe("FORBIDDEN");
    expect(
      (
        await call("list_leadership_requests", [
          m,
          "all",
          null,
          null,
          null,
          null,
          null,
          0,
        ])
      ).code
    ).toBe("FORBIDDEN");

    const appointment = approved.appointmentId as string;
    expect(
      (
        await call("update_leadership_appointment", [
          people.technical,
          appointment,
          1,
          "assistant_chief",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("revoke_leadership_appointment", [
          people.technical,
          appointment,
          1,
          "Technical cannot end appointments.",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("update_leadership_appointment", [
          people.board,
          appointment,
          1,
          "assistant_chief",
          "Agreed with the committee.",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("revoke_leadership_appointment", [
          people.affairs,
          appointment,
          1,
          "Stepped down",
          null,
        ])
      ).code
    ).toBe("STALE_REVISION");
    expect(
      (
        await call("revoke_leadership_appointment", [
          people.affairs,
          appointment,
          2,
          "Stepped down at the end of term.",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    const ended = await call("get_own_leadership", [m]);
    expect(ended.appointments[0]).toMatchObject({
      active: false,
      endReason: "Stepped down at the end of term.",
      position: { id: "assistant_chief" },
    });
    const detail = await call("get_leadership_request", [
      people.board,
      second.requestId,
    ]);
    expect(detail.history.map((h: Result) => h.action)).toEqual([
      "leadership.requested",
      "leadership.approved",
      "appointment.updated",
      "appointment.revoked",
    ]);
    const requests =
      await admin`SELECT status FROM private.leadership_requests WHERE member_id = ${m} ORDER BY submitted_at`;
    expect(requests.map((r) => r.status)).toEqual(["rejected", "approved"]);
  });

  it("refuses self-approval and self-appointment", async () => {
    const c = await committee();
    const t = await team(c);
    await member({ id: people.board });
    const own = await requestLeadership(people.board, c, t);
    expect(own.code).toBe("SUCCESS");
    expect(
      (await decideLeadership(people.board, own.requestId, 1, "approve")).code
    ).toBe("SELF_REVIEW");
    expect(
      (
        await call("assign_leadership", [
          people.board,
          people.board,
          t,
          "chief",
          null,
        ])
      ).code
    ).toBe("SELF_REVIEW");
    // Technical access is not review authority; another reviewer decides it.
    expect(
      (await decideLeadership(people.technical, own.requestId, 1, "approve"))
        .code
    ).toBe("FORBIDDEN");
    expect(
      (await decideLeadership(people.affairs, own.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
  });

  it("never exceeds a position's holders under concurrent approvals, and serializes duplicate requests", async () => {
    const c = await committee();
    const t = await team(c);
    const one = await member();
    const two = await member();
    const r1 = await requestLeadership(one, c, t);
    const r2 = await requestLeadership(two, c, t);
    const outcomes = await Promise.all([
      decideLeadership(people.board, r1.requestId, 1, "approve", null, runtime),
      decideLeadership(
        people.affairs,
        r2.requestId,
        1,
        "approve",
        null,
        runtime2
      ),
    ]);
    expect(outcomes.map((o) => o.code).sort()).toEqual([
      "POSITION_FULL",
      "SUCCESS",
    ]);
    const [{ chiefs }] =
      await admin`SELECT count(*)::int AS chiefs FROM private.leadership_appointments
        WHERE team_id = ${t} AND position_id = 'chief' AND ended_at IS NULL`;
    expect(chiefs).toBe(1);

    const three = await member();
    const t2 = await team(c);
    const duplicate = await Promise.all([
      requestLeadership(three, c, t2, "chief", runtime),
      requestLeadership(three, c, t2, "chief", runtime2),
    ]);
    expect(duplicate.map((d) => d.code).sort()).toEqual([
      "ALREADY_PENDING",
      "SUCCESS",
    ]);
  });

  it("allows appointments across teams but one position per team, capping the total only when Technical sets a limit", async () => {
    const c = await committee();
    const t1 = await team(c);
    const t2 = await team(c);
    const t3 = await team(await committee());
    const m = await member();
    expect(
      (await call("assign_leadership", [people.board, m, t1, "chief", null]))
        .code
    ).toBe("SUCCESS");
    // Another team: allowed by default.
    const request = await requestLeadership(m, c, t2, "assistant_chief");
    expect(
      (await decideLeadership(people.board, request.requestId, 1, "approve"))
        .code
    ).toBe("SUCCESS");
    // Never both positions in the same team, by request or directly.
    expect((await requestLeadership(m, c, t1, "assistant_chief")).code).toBe(
      "ALREADY_APPOINTED"
    );
    expect(
      (
        await call("assign_leadership", [
          people.board,
          m,
          t1,
          "assistant_chief",
          null,
        ])
      ).code
    ).toBe("ALREADY_APPOINTED");
    // An optional total, set by Technical, applies to new appointments only.
    expect(
      (
        await call("set_verification_settings", [
          people.technical,
          3,
          null,
          5,
          2,
        ])
      ).code
    ).toBe("SUCCESS");
    const [{ committee_id: c3 }] =
      await admin`SELECT committee_id FROM private.committee_teams WHERE id = ${t3}`;
    const third = await requestLeadership(m, c3, t3);
    expect(
      (await decideLeadership(people.board, third.requestId, 1, "approve")).code
    ).toBe("MEMBER_LIMIT_REACHED");
    await call("set_verification_settings", [
      people.technical,
      3,
      null,
      5,
      null,
    ]);
    expect(
      (await decideLeadership(people.board, third.requestId, 1, "approve")).code
    ).toBe("SUCCESS");
    expect((await call("get_own_leadership", [m])).limits).toMatchObject({
      maxActiveAppointments: null,
      activeAppointments: 3,
    });
    // A raised position limit allows a second holder; a lowered one keeps existing holders.
    const other = await member();
    expect(
      (
        await call("assign_leadership", [
          people.board,
          other,
          t1,
          "chief",
          null,
        ])
      ).code
    ).toBe("POSITION_FULL");
    expect(
      (await call("set_position_limit", [people.manager, "chief", 2])).code
    ).toBe("FORBIDDEN");
    expect(
      (await call("set_position_limit", [people.technical, "chief", 2])).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("assign_leadership", [
          people.board,
          other,
          t1,
          "chief",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("set_position_limit", [people.technical, "chief", 1])).code
    ).toBe("SUCCESS");
    const [{ chiefs }] =
      await admin`SELECT count(*)::int AS chiefs FROM private.leadership_appointments
        WHERE team_id = ${t1} AND position_id = 'chief' AND ended_at IS NULL`;
    expect(chiefs).toBe(2);
  });

  it("closes pending requests when a team moves or stops being active, keeping appointments and administrative access", async () => {
    const a = await committee();
    const b = await committee();
    const t = await team(a);
    const leader = await member();
    expect(
      (
        await call("assign_leadership", [
          people.board,
          leader,
          t,
          "chief",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    const m = await member();
    const pending = await requestLeadership(m, a, t, "assistant_chief");
    const accessBefore =
      await admin`SELECT user_id, access_level, committee_id, revoked_at FROM public.administrative_access ORDER BY user_id`;
    expect((await call("admin_move_team", [people.affairs, t, b])).code).toBe(
      "FORBIDDEN"
    );
    const moved = await call("admin_move_team", [people.board, t, b]);
    expect(moved).toEqual({ code: "SUCCESS", cancelledRequests: 1 });
    const accessAfter =
      await admin`SELECT user_id, access_level, committee_id, revoked_at FROM public.administrative_access ORDER BY user_id`;
    expect(accessAfter).toEqual(accessBefore);
    expect(
      (await decideLeadership(people.board, pending.requestId, 1, "approve"))
        .code
    ).toBe("STALE_REVISION");
    expect(
      (await decideLeadership(people.board, pending.requestId, 2, "approve"))
        .code
    ).toBe("INVALID_TRANSITION");
    const closed = await call("get_own_leadership", [m]);
    expect(closed.requests[0]).toMatchObject({
      status: "cancelled",
      cancellationReason: "team_moved",
    });
    // A request the structure closed is not the member's attempt: it does not count.
    expect(closed.limits.recentRequests).toBe(0);
    // The leader's appointment followed the team to its new committee.
    expect(
      (await call("get_own_leadership", [leader])).appointments[0]
    ).toMatchObject({
      active: true,
      committee: { id: b },
    });
    expect((await requestLeadership(m, a, t, "assistant_chief")).code).toBe(
      "HIERARCHY_MISMATCH"
    );

    const again = await requestLeadership(m, b, t, "assistant_chief");
    expect(again.code).toBe("SUCCESS");
    expect(
      (await call("admin_set_team_status", [people.board, t, "inactive"]))
        .cancelledRequests
    ).toBe(1);
    expect((await requestLeadership(m, b, t, "assistant_chief")).code).toBe(
      "TEAM_INACTIVE"
    );
    expect((await call("get_own_leadership", [m])).limits.recentRequests).toBe(
      0
    );
    expect(
      await call("admin_set_team_status", [people.board, t, "archived"])
    ).toEqual({ code: "BLOCKED", appointments: 1 });
    expect(
      await call("admin_set_committee_archived", [people.board, b, true])
    ).toMatchObject({ code: "BLOCKED", appointments: 1 });
    const [{ id: appointment, revision }] =
      await admin`SELECT id, revision FROM private.leadership_appointments WHERE member_id = ${leader}`;
    expect(
      (
        await call("revoke_leadership_appointment", [
          people.board,
          appointment,
          revision,
          "Team retired.",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("admin_set_team_status", [people.board, t, "archived"])).code
    ).toBe("SUCCESS");
    expect((await call("admin_delete_team", [people.board, t])).code).toBe(
      "IN_USE"
    );
    const unused = await team(b);
    expect((await call("admin_delete_team", [people.board, unused])).code).toBe(
      "SUCCESS"
    );
    expect(
      (await call("admin_set_committee_archived", [people.board, b, true])).code
    ).toBe("SUCCESS");
  });

  it("refuses to approve against a structure that changed outside the routines", async () => {
    const c = await committee();
    const t = await team(c);
    const m = await member();
    const pending = await requestLeadership(m, c, t);
    await admin`UPDATE private.committee_teams SET status = 'inactive' WHERE id = ${t}`;
    expect(
      (await decideLeadership(people.board, pending.requestId, 1, "approve"))
        .code
    ).toBe("STALE_STRUCTURE");
    const detail = await call("get_leadership_request", [
      people.board,
      pending.requestId,
    ]);
    expect(detail.stale).toBe(true);
  });

  it("assigns directly only for leadership reviewers and never over a pending request", async () => {
    const c = await committee();
    const t = await team(c);
    const m = await member();
    // Technical manages teams but does not appoint.
    expect(
      (await call("assign_leadership", [people.technical, m, t, "chief", null]))
        .code
    ).toBe("FORBIDDEN");
    await requestLeadership(m, c, t);
    expect(
      (await call("assign_leadership", [people.board, m, t, "chief", null]))
        .code
    ).toBe("PENDING_REQUEST");
    expect(
      (
        await call("assign_leadership", [
          people.board,
          randomUUID(),
          t,
          "chief",
          null,
        ])
      ).code
    ).toBe("MEMBER_NOT_FOUND");
    const filtered = await call("list_leadership_requests", [
      people.affairs,
      "pending",
      c,
      t,
      null,
      null,
      null,
      0,
    ]);
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      memberId: m,
      team: { id: t },
      committee: { id: c },
      position: { id: "chief" },
    });
    // The filter lists are names only, for reviewers only.
    const options = await call("leadership_filter_options", [people.affairs]);
    expect(options.committees.find((x: Result) => x.id === c).teams).toEqual([
      { id: t, name: expect.any(String), status: "active" },
    ]);
    expect((await call("leadership_filter_options", [m])).code).toBe(
      "FORBIDDEN"
    );
  });

  // ------------------------------------------------------------------------------------------
  // Deletion and erasure
  // ------------------------------------------------------------------------------------------
  it("removes a member's verification and leadership records with the membership, and treats decisions as accountability", async () => {
    const c = await committee();
    const t = await team(c);
    const m = await member();
    const squ = await submitSqu(m);
    await decideSqu(people.affairs, squ.requestId, 1, "approve");
    const lead = await requestLeadership(m, c, t);
    await decideLeadership(people.affairs, lead.requestId, 1, "approve");
    const preview = await call("preview_member_deletion", [
      people.board,
      m,
      "membership",
    ]);
    expect(preview.preview).toMatchObject({
      verificationRequests: 1,
      leadershipRequests: 1,
      appointments: 1,
      blockers: [],
    });
    const [{ email }] =
      await admin`SELECT email FROM public.members WHERE id = ${m}`;
    const deleted = await call("delete_member_record", [
      people.board,
      m,
      email,
      null,
    ]);
    expect(deleted).toMatchObject({
      code: "SUCCESS",
      verificationRequestsDeleted: 1,
      leadershipRequestsDeleted: 1,
      appointmentsDeleted: 1,
    });
    for (const table of [
      "squ_verification_requests",
      "squ_verifications",
      "leadership_requests",
      "leadership_appointments",
    ]) {
      const [{ n }] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM private.${table} WHERE member_id = $1`,
        [m]
      );
      expect(n, table).toBe(0);
    }
    const erasure = await call("preview_member_deletion", [
      people.technical,
      people.affairs,
      "account",
    ]);
    expect(erasure.preview.blockers).toContain("ACCOUNTABILITY_RECORDS");
  });
});
