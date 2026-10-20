import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  runtimeDb,
  close,
  createFixture,
  registration,
} from "./helpers";

describe("event media, member registration and attendance (real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(() => close(admin, runtime));
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const challenge = "a".repeat(64);
  let seq = 0;
  const ip = () => `198.19.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  async function call(fn: string, values: unknown[]) {
    const rows = await runtime.unsafe(
      `SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return rows[0].result;
  }
  async function member(confirmed = true) {
    const id = randomUUID();
    const email = `${id}@example.test`;
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${email},${confirmed ? new Date() : null})`;
    await admin`INSERT INTO public.members(id,full_name,email,university_id) VALUES(${id},'Synthetic Member',${email},${id})`;
    return { id, email };
  }
  async function open(actor: string, event: string) {
    return call("manage_event_checkin", [
      actor,
      event,
      "open",
      hash(challenge),
      new Date(Date.now() + 3600_000),
    ]);
  }
  async function signedRegistration(
    actor: string,
    event: string,
    intent = "register"
  ) {
    return call("register_event_member", [actor, event, intent, ip()]);
  }
  const confirm = (actor: string, event: string, token = challenge) =>
    call("confirm_member_attendance", [actor, event, hash(token)]);

  it("atomically creates/edits covers and phone requirements with scope, revisions and approval invalidation", async () => {
    const f = await createFixture(admin);
    const key = `event-covers/${randomUUID()}.png`;
    const values = [
      f.managerId,
      null,
      f.committeeId,
      null,
      "Synthetic linked event",
      "Details [SQU](https://www.squ.edu.om)\nمرحبا",
      new Date(Date.now() + 86400_000),
      "Lab",
      1,
      key,
      true,
    ];
    const created = await call("save_event_details", values);
    expect(created.code).toBe("SUCCESS");
    const id = created.eventId;
    expect(
      await call("admin_event_options", [f.otherManagerId, id])
    ).toBeNull();
    expect(await call("admin_event_options", [f.managerId, id])).toEqual({
      coverImageKey: key,
      phoneRequired: true,
    });
    const [before] = await admin`SELECT * FROM public.events WHERE id=${id}`;
    const edited = await call("save_event_details", [
      f.managerId,
      id,
      null,
      before.revision,
      "Edited event",
      before.description,
      before.event_date,
      "Hall",
      1,
      null,
      false,
    ]);
    expect(edited.code).toBe("SUCCESS");
    expect(edited.revision).toBe(before.revision + 1);
    expect(
      (
        await call("save_event_details", [
          f.managerId,
          id,
          null,
          before.revision,
          "Stale",
          before.description,
          before.event_date,
          "Hall",
          1,
          key,
          true,
        ])
      ).code
    ).toBe("CONFLICT");
    expect(
      (
        await call("save_event_details", [
          f.otherManagerId,
          id,
          null,
          edited.revision,
          "Foreign",
          before.description,
          before.event_date,
          "Hall",
          1,
          key,
          true,
        ])
      ).code
    ).toBe("NOT_FOUND");
    await admin`UPDATE public.events SET review_required=true,flagged_by=${f.managerId},approved_by=${f.boardReviewerId},approved_at=now(),approved_revision=revision WHERE id=${id}`;
    const optionsEdit = await call("save_event_details", [
      f.managerId,
      id,
      null,
      edited.revision,
      "Edited event",
      before.description,
      before.event_date,
      "Hall",
      1,
      key,
      true,
    ]);
    expect(optionsEdit.code).toBe("SUCCESS");
    const [after] =
      await admin`SELECT approved_by,revision,cover_image_key,description FROM public.events WHERE id=${id}`;
    expect(after.approved_by).toBeNull();
    expect(after.description).toContain("[SQU](https://www.squ.edu.om)");
    expect(after.cover_image_key).toBe(key);
  });

  it("requires a private E.164 profile phone only when configured, and reuses trusted identity", async () => {
    const f = await createFixture(admin, { status: "published", capacity: 1 });
    const m = await member();
    const waiting = await member();
    const unconfirmed = await member(false);
    await admin`UPDATE public.events SET phone_required=true WHERE id=${f.eventId}`;
    expect((await signedRegistration(m.id, f.eventId)).code).toBe(
      "PHONE_REQUIRED"
    );
    expect((await call("update_member_phone", [m.id, "91234567"])).code).toBe(
      "PHONE_REQUIRED"
    );
    expect(
      (await call("update_member_phone", [unconfirmed.id, "+96891234567"])).code
    ).toBe("EMAIL_UNCONFIRMED");
    expect(
      (await call("update_member_phone", [m.id, "+96891234567"])).phone
    ).toBe("+96891234567");
    expect((await signedRegistration(m.id, f.eventId)).code).toBe("SUCCESS");
    await call("update_member_phone", [waiting.id, "+442071234567"]);
    expect((await signedRegistration(waiting.id, f.eventId)).code).toBe(
      "EVENT_FULL"
    );
    expect(
      (await signedRegistration(waiting.id, f.eventId, "join_waitlist")).code
    ).toBe("WAITLISTED");
    const [row] =
      await admin`SELECT * FROM public.registrations WHERE event_id=${f.eventId} AND member_id=${m.id}`;
    expect(row.attendee_name).toBe("Synthetic Member");
    expect(row.attendee_email).toBe(m.email);
    expect(row.attendee_phone).toBe("+96891234567");
    expect((await signedRegistration(m.id, f.eventId)).code).toBe(
      "ALREADY_REGISTERED"
    );
    const options =
      await runtime`SELECT * FROM private.public_event_options(ARRAY[${f.eventId}::uuid])`;
    expect(Object.keys(options[0]).sort()).toEqual([
      "cover_image_key",
      "id",
      "phone_required",
    ]);
    expect((await call("get_member_profile", [m.id])).phone).toBe(
      "+96891234567"
    );
    expect((await call("get_member_profile", [waiting.id])).phone).toBe(
      "+442071234567"
    );
  });

  it("preserves guest registration and never claims a guest by email", async () => {
    const f = await createFixture(admin, { status: "published" });
    const m = await member();
    expect(
      (await registration(runtime, f.eventId, m.email, "register", ip())).code
    ).toBe("SUCCESS");
    expect((await signedRegistration(m.id, f.eventId)).code).toBe(
      "ALREADY_REGISTERED"
    );
    await open(f.managerId, f.eventId);
    expect((await confirm(m.id, f.eventId)).code).toBe("NOT_REGISTERED");
    const [row] =
      await admin`SELECT member_id,attended FROM public.registrations WHERE event_id=${f.eventId}`;
    expect(row).toEqual({ member_id: null, attended: false });
    const required = await createFixture(admin, { status: "published" });
    await admin`UPDATE public.events SET phone_required=true WHERE id=${required.eventId}`;
    expect(
      (
        await registration(
          runtime,
          required.eventId,
          "guest@example.test",
          "register",
          ip()
        )
      ).code
    ).toBe("PHONE_REQUIRED");
    expect(
      (
        await call("register_event_guest", [
          required.eventId,
          "Guest",
          "guest@example.test",
          "register",
          ip(),
          "+96891234567",
        ])
      ).code
    ).toBe("SUCCESS");
  });

  it("records attendance only after explicit confirmation and returns the original timestamp on concurrent retries", async () => {
    const f = await createFixture(admin, { status: "published" });
    const m = await member();
    await signedRegistration(m.id, f.eventId);
    expect((await confirm(m.id, f.eventId)).code).toBe("CHECKIN_CLOSED");
    expect((await open(f.otherManagerId, f.eventId)).code).toBe("NOT_FOUND");
    expect((await open(f.managerId, f.eventId)).isOpen).toBe(true);
    const viewed = await call("get_member_event", [m.id, f.eventId]);
    expect(viewed.registration.attended).toBe(false);
    expect(viewed).not.toHaveProperty("challenge_hash");
    const responses = await Promise.all([
      confirm(m.id, f.eventId),
      confirm(m.id, f.eventId),
    ]);
    expect(responses.every((r) => r.code === "SUCCESS")).toBe(true);
    expect(responses[0].checkedInAt).toBe(responses[1].checkedInAt);
    expect(responses.map((r) => r.alreadyAttended).sort()).toEqual([
      false,
      true,
    ]);
    const [audit] =
      await admin`SELECT count(*)::integer AS count FROM private.uc02_audit WHERE event_id=${f.eventId} AND action='attendance.confirmed'`;
    expect(audit.count).toBe(1);
    await call("manage_event_checkin", [
      f.managerId,
      f.eventId,
      "close",
      null,
      null,
    ]);
    expect((await confirm(m.id, f.eventId)).checkedInAt).toBe(
      responses[0].checkedInAt
    );
  });

  it("rejects waitlists, invalid/expired/revoked challenges, closed windows and wrong events", async () => {
    const f = await createFixture(admin, { status: "published", capacity: 1 });
    const m = await member();
    const w = await member();
    await signedRegistration(m.id, f.eventId);
    await signedRegistration(w.id, f.eventId, "join_waitlist");
    await open(f.managerId, f.eventId);
    expect((await confirm(w.id, f.eventId)).code).toBe("WAITLISTED");
    expect((await confirm(m.id, f.eventId, "wrong")).code).toBe(
      "INVALID_CHALLENGE"
    );
    await admin`UPDATE private.event_checkin_sessions SET challenge_expires_at=now()-interval '1 second' WHERE event_id=${f.eventId}`;
    expect((await confirm(m.id, f.eventId)).code).toBe("CHALLENGE_EXPIRED");
    await call("manage_event_checkin", [
      f.managerId,
      f.eventId,
      "rotate",
      hash("b".repeat(64)),
      null,
    ]);
    expect((await confirm(m.id, f.eventId)).code).toBe("INVALID_CHALLENGE");
    const other = await createFixture(admin, { status: "published" });
    expect((await confirm(m.id, other.eventId)).code).toBe("NOT_REGISTERED");
    await call("manage_event_checkin", [
      f.managerId,
      f.eventId,
      "close",
      null,
      null,
    ]);
    expect((await confirm(m.id, f.eventId, "b".repeat(64))).code).toBe(
      "CHECKIN_CLOSED"
    );
  });

  it("keeps attendance lists/counts/exports scoped, private, filtered and paginated", async () => {
    const f = await createFixture(admin, { status: "published" });
    const m = await member();
    const second = await member();
    await signedRegistration(m.id, f.eventId);
    await signedRegistration(second.id, f.eventId);
    await open(f.managerId, f.eventId);
    await confirm(m.id, f.eventId);
    expect(
      (
        await call("list_event_attendance", [
          f.otherManagerId,
          f.eventId,
          "all",
          "",
          null,
          51,
          false,
        ])
      ).code
    ).toBe("NOT_FOUND");
    const list = await call("list_event_attendance", [
      f.managerId,
      f.eventId,
      "all",
      "",
      null,
      1,
      false,
    ]);
    expect(list.total).toBe(2);
    expect(list.confirmed).toBe(2);
    expect(list.attended).toBe(1);
    expect(list.rows).toHaveLength(1);
    const next = await call("list_event_attendance", [
      f.managerId,
      f.eventId,
      "all",
      "",
      list.rows[0].id,
      1,
      false,
    ]);
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0].id).not.toBe(list.rows[0].id);
    const absent = await call("list_event_attendance", [
      f.managerId,
      f.eventId,
      "absent",
      second.email,
      null,
      51,
      false,
    ]);
    expect(absent.rows).toHaveLength(1);
    expect(absent.rows[0].attended).toBe(false);
    const exported = await call("list_event_attendance", [
      f.boardReviewerId,
      f.eventId,
      "attended",
      "",
      null,
      10000,
      true,
    ]);
    expect(exported.rows).toHaveLength(1);
    expect(exported.rows[0]).not.toHaveProperty("phone");
    for (const role of ["anon", "authenticated"]) {
      await expect(
        admin.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT * FROM private.event_checkin_sessions`;
        })
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT phone FROM public.members`;
        })
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      runtime`SELECT * FROM private.event_checkin_sessions`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime`SELECT private.register_for_event_base(${f.eventId},'Attacker','attacker@example.test','register','198.19.3.1'::inet)`
    ).rejects.toMatchObject({ code: "42501" });
  });
});
