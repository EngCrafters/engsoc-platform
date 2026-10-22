import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  runtimeDb,
  close,
  createFixture,
  registration,
} from "./helpers";

describe("member profiles (0031, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(() => close(admin, runtime));
  let seq = 0;
  const ip = () => `198.20.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  async function call(fn: string, values: unknown[]) {
    const rows = await runtime.unsafe(
      `SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return rows[0].result;
  }
  async function member(
    options: { confirmed?: boolean; withApplication?: boolean } = {}
  ) {
    const id = randomUUID();
    const studentId = String(
      10_000_000 + Math.floor(Math.random() * 89_999_999)
    );
    const email = `m${studentId}@squ.edu.om`;
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${email},${options.confirmed === false ? null : new Date()})`;
    await admin`INSERT INTO public.members(id,full_name,email,university_id,year,major) VALUES(${id},'Synthetic Member',${email},${studentId},2,'mechanical')`;
    if (options.withApplication)
      await admin`INSERT INTO private.membership_applications (full_name,email,university_id,academic_year,discipline,interests,consent_version,status_token_hash,auth_user_id)
        VALUES ('Synthetic Member',${email},${studentId},2,'mechanical',ARRAY['robotics','data'],'2026-10-v1',${randomBytes(32).toString("hex")},${id})`;
    return { id, email, studentId };
  }

  it("serves only a confirmed member their own profile, with interests from the application until edited", async () => {
    const m = await member({ withApplication: true });
    const profile = await call("get_own_profile", [m.id]);
    expect(profile).toMatchObject({
      code: "SUCCESS",
      name: "Synthetic Member",
      email: m.email,
      universityId: m.studentId,
      academicYear: 2,
      discipline: "mechanical",
      interests: ["robotics", "data"],
      phone: null,
      hasPhoto: false,
      status: "member",
      application: { status: "pending_review" },
      changeRequests: [],
    });
    const unconfirmed = await member({ confirmed: false });
    expect((await call("get_own_profile", [unconfirmed.id])).code).toBe(
      "EMAIL_UNCONFIRMED"
    );
    const applicantOnly = randomUUID();
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${applicantOnly},${`a${applicantOnly.slice(0, 8)}@squ.edu.om`},now())`;
    expect((await call("get_own_profile", [applicantOnly])).code).toBe(
      "MEMBER_REQUIRED"
    );
    expect((await call("get_own_profile", [randomUUID()])).code).toBe(
      "NOT_FOUND"
    );
  });

  it("validates and saves self-service fields, auditing which fields changed", async () => {
    const m = await member({ withApplication: true });
    const edit = (
      phone: string | null,
      year: number | null,
      discipline: string | null,
      interests: string[] | null
    ) => call("update_own_profile", [m.id, phone, year, discipline, interests]);
    expect((await edit("91234567", 3, "civil", [])).field).toBe("phone");
    expect((await edit(null, 6, "civil", [])).field).toBe("academicYear");
    expect((await edit(null, 3, "astronomy", [])).field).toBe("discipline");
    expect((await edit(null, 3, "civil", ["cad", "cad"])).field).toBe(
      "interests"
    );
    expect(
      (await edit(null, 3, "civil", ["cad", "data", "hse", "power", "process"]))
        .field
    ).toBe("interests");
    expect((await edit(null, 3, "civil", ["telepathy"])).field).toBe(
      "interests"
    );
    const saved = await edit("+96891234567", 3, "civil", ["cad", "hse"]);
    expect(saved).toMatchObject({
      code: "SUCCESS",
      phone: "+96891234567",
      academicYear: 3,
      discipline: "civil",
      interests: ["cad", "hse"],
    });
    expect(saved.updatedAt).not.toBeNull();
    // Saving the same values again changes and audits nothing.
    await edit("+96891234567", 3, "civil", ["cad", "hse"]);
    const audit =
      await admin`SELECT changes FROM private.uc02_audit WHERE actor_user_id=${m.id} AND action='member.profile_updated'`;
    expect(audit).toEqual([
      {
        changes: {
          fields: ["phone", "academicYear", "discipline", "interests"],
        },
      },
    ]);
    // Clearing the phone is allowed; verified fields are not editable here at all.
    expect((await edit(null, 3, "civil", ["cad", "hse"])).phone).toBeNull();
    const [row] =
      await admin`SELECT full_name, university_id, email FROM public.members WHERE id=${m.id}`;
    expect(row).toEqual({
      full_name: "Synthetic Member",
      university_id: m.studentId,
      email: m.email,
    });
  });

  it("follows a confirmed SQU sign-in email change, and nothing else", async () => {
    const m = await member();
    const next = `changed${m.studentId}@squ.edu.om`;
    await admin`UPDATE auth.users SET email=${next} WHERE id=${m.id}`;
    expect((await call("get_own_profile", [m.id])).email).toBe(next);
    await admin`UPDATE auth.users SET email=${`personal${m.studentId}@gmail.com`} WHERE id=${m.id}`;
    const profile = await call("get_own_profile", [m.id]);
    expect(profile.email).toBe(next);
    expect(profile.signInEmail).toBe(`personal${m.studentId}@gmail.com`);
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM private.uc02_audit WHERE actor_user_id=${m.id} AND action='member.email_synced'`;
    expect(n).toBe(1);
  });

  it("keeps one private photo key per member and hands back the previous one for deletion", async () => {
    const m = await member();
    const first = `member-photos/${randomUUID()}.jpg`;
    const second = `member-photos/${randomUUID()}.jpg`;
    expect(
      (await call("set_own_photo", [m.id, "member-photos/../x.jpg"])).code
    ).toBe("VALIDATION_ERROR");
    expect(await call("set_own_photo", [m.id, first])).toEqual({
      code: "SUCCESS",
      previousKey: null,
    });
    expect(await call("get_own_photo_key", [m.id])).toBe(first);
    expect((await call("get_own_profile", [m.id])).hasPhoto).toBe(true);
    expect(await call("set_own_photo", [m.id, second])).toEqual({
      code: "SUCCESS",
      previousKey: first,
    });
    expect(await call("set_own_photo", [m.id, null])).toEqual({
      code: "SUCCESS",
      previousKey: second,
    });
    expect(await call("get_own_photo_key", [m.id])).toBeNull();
    const outsider = await member({ confirmed: false });
    expect(await call("get_own_photo_key", [outsider.id])).toBeNull();
  });

  it("lists the member's own registrations, linking guest ones made with their confirmed email", async () => {
    const f = await createFixture(admin, { status: "published" });
    const draft = await createFixture(admin, { status: "draft" });
    const m = await member();
    expect(
      (await registration(runtime, f.eventId, m.email, "register", ip())).code
    ).toBe("SUCCESS");
    const other = await member();
    await registration(runtime, f.eventId, other.email, "register", ip());
    const result = await call("list_own_registrations", [m.id]);
    expect(result.code).toBe("SUCCESS");
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0]).toMatchObject({
      eventId: f.eventId,
      status: "confirmed",
      attended: false,
    });
    expect(JSON.stringify(result)).not.toContain(other.email);
    expect(JSON.stringify(result)).not.toContain(draft.eventId);
    const [linked] =
      await admin`SELECT member_id FROM public.registrations WHERE event_id=${f.eventId} AND attendee_email=${m.email}`;
    expect(linked.member_id).toBe(m.id);
  });

  it("routes verified-field corrections through a membership reviewer, never the member", async () => {
    const f = await createFixture(admin);
    const m = await member();
    const peer = await member();
    expect(
      (await call("request_profile_change", [m.id, "email", "x@squ.edu.om"]))
        .code
    ).toBe("VALIDATION_ERROR");
    expect(
      (await call("request_profile_change", [m.id, "university_id", "12ab"]))
        .code
    ).toBe("VALIDATION_ERROR");
    expect(
      (
        await call("request_profile_change", [
          m.id,
          "full_name",
          "Synthetic Member",
        ])
      ).code
    ).toBe("UNCHANGED");
    const requested = await call("request_profile_change", [
      m.id,
      "full_name",
      "Synthetic Corrected Name",
    ]);
    expect(requested.changeRequests[0]).toMatchObject({
      field: "full_name",
      status: "pending",
      requestedValue: "Synthetic Corrected Name",
    });
    expect(
      (
        await call("request_profile_change", [
          m.id,
          "full_name",
          "Another Name",
        ])
      ).code
    ).toBe("ALREADY_PENDING");
    expect(
      (
        await call("request_profile_change", [
          m.id,
          "university_id",
          peer.studentId,
        ])
      ).code
    ).toBe("SUCCESS");
    // Only membership reviewers see or decide requests.
    expect(
      (await call("list_profile_change_requests", [f.managerId])).code
    ).toBe("FORBIDDEN");
    expect((await call("list_profile_change_requests", [m.id])).code).toBe(
      "FORBIDDEN"
    );
    const list = await call("list_profile_change_requests", [
      f.boardReviewerId,
    ]);
    const mine = list.requests.filter(
      (r: { memberEmail: string }) => r.memberEmail === m.email
    );
    expect(mine.map((r: { field: string }) => r.field).sort()).toEqual([
      "full_name",
      "university_id",
    ]);
    const name = mine.find((r: { field: string }) => r.field === "full_name");
    const sid = mine.find(
      (r: { field: string }) => r.field === "university_id"
    );
    expect(name.currentValue).toBe("Synthetic Member");
    expect(
      (
        await call("decide_profile_change", [
          f.managerId,
          name.id,
          "approve",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("decide_profile_change", [
          f.boardReviewerId,
          name.id,
          "approve",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("decide_profile_change", [
          f.boardReviewerId,
          name.id,
          "reject",
          null,
        ])
      ).code
    ).toBe("INVALID_TRANSITION");
    // A student ID already held by another member cannot be approved.
    expect(
      (
        await call("decide_profile_change", [
          f.boardReviewerId,
          sid.id,
          "approve",
          null,
        ])
      ).code
    ).toBe("CONFLICT");
    expect(
      (
        await call("decide_profile_change", [
          f.boardReviewerId,
          sid.id,
          "reject",
          "Does not match the ID card.",
        ])
      ).code
    ).toBe("SUCCESS");
    const profile = await call("get_own_profile", [m.id]);
    expect(profile.name).toBe("Synthetic Corrected Name");
    expect(profile.universityId).toBe(m.studentId);
    expect(
      profile.changeRequests.map((r: { status: string }) => r.status).sort()
    ).toEqual(["approved", "rejected"]);
    // Reviewers cannot decide their own requests.
    await admin`INSERT INTO public.members(id,full_name,email,university_id) VALUES(${f.boardReviewerId},'Synthetic Reviewer',${`r${m.studentId}@squ.edu.om`},${randomUUID()})`;
    await admin`UPDATE auth.users SET email=${`r${m.studentId}@squ.edu.om`}, email_confirmed_at=now() WHERE id=${f.boardReviewerId}`;
    await call("request_profile_change", [
      f.boardReviewerId,
      "full_name",
      "Self Approved Name",
    ]);
    const own = (
      await call("list_profile_change_requests", [f.boardReviewerId])
    ).requests.find((r: { isOwn: boolean }) => r.isOwn);
    expect(
      (
        await call("decide_profile_change", [
          f.boardReviewerId,
          own.id,
          "approve",
          null,
        ])
      ).code
    ).toBe("SELF_REVIEW");
  });

  it("gives browser roles and the runtime no direct access to the new data", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        admin.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT private.get_own_profile(${randomUUID()}::uuid)`;
        })
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT photo_key, interests FROM public.members`;
        })
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      runtime`SELECT * FROM private.member_change_requests`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime`SELECT photo_key FROM public.members`
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await runtime`SELECT private.core_schema_version() AS v`)[0].v
    ).toBeGreaterThanOrEqual(31);
  });
});
