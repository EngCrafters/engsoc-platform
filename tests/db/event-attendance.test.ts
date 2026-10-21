import { randomUUID } from "node:crypto";
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
  const secret = "a".repeat(64);
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
  async function open(actor: string, event: string, key = secret) {
    return call("manage_event_checkin", [
      actor,
      event,
      "open",
      key,
      new Date(Date.now() + 3600_000),
    ]);
  }
  /** The code every organizer screen shows now, as the database derives it. */
  async function liveCode(manager: string, event: string) {
    return (
      await call("manage_event_checkin", [manager, event, "read", null, null])
    ).checkinCode as string;
  }
  /** The code shown `minutesAgo` minutes back, by the database's own clock. */
  async function codeFrom(event: string, minutesAgo: number) {
    const [row] = await admin`SELECT private.checkin_code(code_secret,
      private.checkin_window(clock_timestamp()) - ${minutesAgo}::bigint) AS code
      FROM private.event_checkin_sessions WHERE event_id=${event}`;
    return row.code as string;
  }
  /** Keeps a multi-step code assertion inside one minute. */
  async function awayFromMinuteEdge() {
    const left = 60_000 - (Date.now() % 60_000);
    if (left < 4_000) await new Promise((r) => setTimeout(r, left + 500));
  }
  async function signedRegistration(
    actor: string,
    event: string,
    intent = "register"
  ) {
    return call("register_event_member", [actor, event, intent, ip()]);
  }
  const confirm = (actor: string, event: string, code = "f".repeat(64)) =>
    call("confirm_member_attendance", [actor, event, code]);
  const manual = (
    actor: string,
    event: string,
    registration: string,
    attended: boolean,
    reason: string
  ) =>
    call("record_manual_attendance", [
      actor,
      event,
      registration,
      attended,
      reason,
    ]);

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

  it("links a guest registration only to the member who confirmed that email, keeping the seat", async () => {
    const f = await createFixture(admin, { status: "published", capacity: 1 });
    const m = await member();
    const other = await member();
    expect(
      (await registration(runtime, f.eventId, m.email, "register", ip())).code
    ).toBe("SUCCESS");
    const [before] =
      await admin`SELECT id,registered_at,status FROM public.registrations WHERE event_id=${f.eventId}`;
    // Someone else's account never claims it, whatever they try.
    expect(
      (await call("get_member_event", [other.id, f.eventId])).registration
    ).toBeNull();
    expect((await signedRegistration(other.id, f.eventId)).code).toBe(
      "EVENT_FULL"
    );
    // The owner of the confirmed address sees it as theirs and can check in.
    const viewed = await call("get_member_event", [m.id, f.eventId]);
    expect(viewed.registration.status).toBe("confirmed");
    expect((await signedRegistration(m.id, f.eventId)).code).toBe(
      "ALREADY_REGISTERED"
    );
    await open(f.managerId, f.eventId);
    expect(
      (await confirm(m.id, f.eventId, await liveCode(f.managerId, f.eventId)))
        .code
    ).toBe("SUCCESS");
    const rows =
      await admin`SELECT id,member_id,registered_at,status,attended FROM public.registrations WHERE event_id=${f.eventId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before.id,
      member_id: m.id,
      status: "confirmed",
      attended: true,
    });
    expect(rows[0].registered_at).toEqual(before.registered_at);
    const links =
      await admin`SELECT actor_user_id,changes FROM private.uc02_audit WHERE registration_id=${before.id} AND action='registration.member_linked'`;
    expect(links).toEqual([
      { actor_user_id: m.id, changes: { via: "confirmed_email" } },
    ]);
    // An unconfirmed address proves nothing: no profile, no link.
    const unconfirmed = await member(false);
    expect(
      (
        await registration(
          runtime,
          f.eventId,
          unconfirmed.email,
          "join_waitlist",
          ip()
        )
      ).code
    ).toBe("WAITLISTED");
    expect(
      (await call("get_member_event", [unconfirmed.id, f.eventId])).code
    ).toBe("EMAIL_UNCONFIRMED");
    const [waiting] =
      await admin`SELECT member_id FROM public.registrations WHERE event_id=${f.eventId} AND attendee_email=${unconfirmed.email}`;
    expect(waiting.member_id).toBeNull();
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
    expect(JSON.stringify(viewed)).not.toContain(secret);
    await awayFromMinuteEdge();
    const code = await liveCode(f.managerId, f.eventId);
    const responses = await Promise.all([
      confirm(m.id, f.eventId, code),
      confirm(m.id, f.eventId, code),
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

  it("rejects waitlists, invalid/expired/revoked codes, closed windows and wrong events", async () => {
    const f = await createFixture(admin, { status: "published", capacity: 1 });
    const m = await member();
    const w = await member();
    await signedRegistration(m.id, f.eventId);
    await signedRegistration(w.id, f.eventId, "join_waitlist");
    await open(f.managerId, f.eventId);
    await awayFromMinuteEdge();
    expect(
      (await confirm(w.id, f.eventId, await liveCode(f.managerId, f.eventId)))
        .code
    ).toBe("WAITLISTED");
    expect((await confirm(m.id, f.eventId, "wrong")).code).toBe(
      "INVALID_CHALLENGE"
    );
    expect((await confirm(m.id, f.eventId, "e".repeat(64))).code).toBe(
      "INVALID_CHALLENGE"
    );
    // Shown four minutes ago: past its three-minute life.
    expect(
      (await confirm(m.id, f.eventId, await codeFrom(f.eventId, 4))).code
    ).toBe("CHALLENGE_EXPIRED");
    const beforeRevoke = await liveCode(f.managerId, f.eventId);
    await call("manage_event_checkin", [
      f.managerId,
      f.eventId,
      "rotate",
      "b".repeat(64),
      null,
    ]);
    expect((await confirm(m.id, f.eventId, beforeRevoke)).code).toBe(
      "INVALID_CHALLENGE"
    );
    const other = await createFixture(admin, { status: "published" });
    expect(
      (
        await confirm(
          m.id,
          other.eventId,
          await liveCode(f.managerId, f.eventId)
        )
      ).code
    ).toBe("NOT_REGISTERED");
    const current = await liveCode(f.managerId, f.eventId);
    await call("manage_event_checkin", [
      f.managerId,
      f.eventId,
      "close",
      null,
      null,
    ]);
    expect((await confirm(m.id, f.eventId, current)).code).toBe(
      "CHECKIN_CLOSED"
    );
    const [session] =
      await admin`SELECT is_open,code_secret FROM private.event_checkin_sessions WHERE event_id=${f.eventId}`;
    expect(session).toEqual({ is_open: false, code_secret: null });
  });

  it("shows every screen the same code, never changes it on reading, and accepts it for three minutes", async () => {
    const f = await createFixture(admin, { status: "published" });
    const [a, b, c] = [await member(), await member(), await member()];
    for (const x of [a, b, c]) await signedRegistration(x.id, f.eventId);
    await open(f.managerId, f.eventId);
    await awayFromMinuteEdge();
    // Two organizers' screens, read independently, show one code.
    const screen1 = await call("manage_event_checkin", [
      f.managerId,
      f.eventId,
      "read",
      null,
      null,
    ]);
    const screen2 = await call("manage_event_checkin", [
      f.boardReviewerId,
      f.eventId,
      "read",
      null,
      null,
    ]);
    expect(screen1.checkinCode).toMatch(/^[0-9a-f]{64}$/);
    expect(screen2.checkinCode).toBe(screen1.checkinCode);
    expect(screen1.codeMinutes).toBe(3);
    expect(new Date(screen1.refreshAt).getTime()).toBeGreaterThan(
      Date.now() - 1000
    );
    expect(JSON.stringify(screen1)).not.toContain(secret);
    // Re-opening an open session (a new closing time) keeps codes valid.
    await open(f.managerId, f.eventId, "c".repeat(64));
    expect(await liveCode(f.managerId, f.eventId)).toBe(screen1.checkinCode);
    // Codes shown one and two minutes ago still work; reading wrote nothing.
    expect((await confirm(a.id, f.eventId, screen1.checkinCode)).code).toBe(
      "SUCCESS"
    );
    expect(
      (await confirm(b.id, f.eventId, await codeFrom(f.eventId, 1))).code
    ).toBe("SUCCESS");
    expect(
      (await confirm(c.id, f.eventId, await codeFrom(f.eventId, 2))).code
    ).toBe("SUCCESS");
    const sessionAudit =
      await admin`SELECT changes->>'operation' AS op FROM private.uc02_audit WHERE event_id=${f.eventId} AND action='attendance.session_changed' ORDER BY occurred_at`;
    expect(sessionAudit.map((r) => r.op)).toEqual(["open", "open"]);
    const methods =
      await admin`SELECT DISTINCT checkin_method FROM public.registrations WHERE event_id=${f.eventId}`;
    expect(methods).toEqual([{ checkin_method: "qr" }]);
  });

  it("lets a scoped organizer record or undo attendance with a fixed reason, audited and reversible", async () => {
    const f = await createFixture(admin, { status: "published", capacity: 2 });
    const m = await member();
    expect(
      (
        await registration(
          runtime,
          f.eventId,
          "guest-no-account@example.test",
          "register",
          ip()
        )
      ).code
    ).toBe("SUCCESS");
    await signedRegistration(m.id, f.eventId);
    expect(
      (
        await registration(
          runtime,
          f.eventId,
          "waiting@example.test",
          "join_waitlist",
          ip()
        )
      ).code
    ).toBe("WAITLISTED");
    const [guest] =
      await admin`SELECT id FROM public.registrations WHERE event_id=${f.eventId} AND attendee_email='guest-no-account@example.test'`;
    const [waiting] =
      await admin`SELECT id FROM public.registrations WHERE event_id=${f.eventId} AND status='waitlisted'`;
    const [own] =
      await admin`SELECT id FROM public.registrations WHERE event_id=${f.eventId} AND member_id=${m.id}`;
    expect(
      (await manual(f.otherManagerId, f.eventId, guest.id, true, "no_account"))
        .code
    ).toBe("NOT_FOUND");
    expect(
      (await manual(f.managerId, f.eventId, guest.id, true, "because")).code
    ).toBe("VALIDATION_ERROR");
    expect(
      (await manual(f.managerId, f.eventId, guest.id, true, "not_present")).code
    ).toBe("VALIDATION_ERROR");
    expect(
      (await manual(f.managerId, f.eventId, waiting.id, true, "no_account"))
        .code
    ).toBe("WAITLISTED");
    const other = await createFixture(admin, { status: "published" });
    expect(
      (await manual(f.managerId, other.eventId, guest.id, true, "no_account"))
        .code
    ).toBe("NOT_FOUND");
    // An organizer who is also registered cannot mark themselves.
    await admin`INSERT INTO public.members(id,full_name,email,university_id) VALUES(${f.managerId},'Organizer','organizer@example.test',${f.managerId})`;
    await admin`UPDATE public.registrations SET member_id=${f.managerId} WHERE id=${own.id}`;
    expect(
      (await manual(f.managerId, f.eventId, own.id, true, "organizer_verified"))
        .code
    ).toBe("SELF_CHECKIN");
    expect(
      (
        await manual(
          f.boardReviewerId,
          f.eventId,
          own.id,
          true,
          "organizer_verified"
        )
      ).code
    ).toBe("SUCCESS");
    // A guest without an account is checked in by an organizer, once.
    const checked = await manual(
      f.managerId,
      f.eventId,
      guest.id,
      true,
      "no_account"
    );
    expect(checked).toMatchObject({
      code: "SUCCESS",
      attended: true,
      unchanged: false,
    });
    expect(
      (await manual(f.managerId, f.eventId, guest.id, true, "no_account"))
        .unchanged
    ).toBe(true);
    let [row] =
      await admin`SELECT attended,checkin_method,checked_in_at FROM public.registrations WHERE id=${guest.id}`;
    expect(row).toMatchObject({ attended: true, checkin_method: "manual" });
    expect(row.checked_in_at).not.toBeNull();
    // Undo needs an undo reason and restores the unattended state.
    expect(
      (await manual(f.managerId, f.eventId, guest.id, false, "no_account")).code
    ).toBe("VALIDATION_ERROR");
    expect(
      (
        await manual(
          f.managerId,
          f.eventId,
          guest.id,
          false,
          "recorded_in_error"
        )
      ).code
    ).toBe("SUCCESS");
    [row] =
      await admin`SELECT attended,checkin_method,checked_in_at FROM public.registrations WHERE id=${guest.id}`;
    expect(row).toEqual({
      attended: false,
      checkin_method: null,
      checked_in_at: null,
    });
    const audit =
      await admin`SELECT action,actor_user_id,changes FROM private.uc02_audit WHERE registration_id=${guest.id} AND action LIKE 'attendance.manual%' ORDER BY occurred_at`;
    expect(audit).toEqual([
      {
        action: "attendance.manual_confirmed",
        actor_user_id: f.managerId,
        changes: { reason: "no_account", previousMethod: null },
      },
      {
        action: "attendance.manual_reverted",
        actor_user_id: f.managerId,
        changes: { reason: "recorded_in_error", previousMethod: "manual" },
      },
    ]);
    // The runtime role can call it only through the routine; browser roles cannot.
    for (const role of ["anon", "authenticated"]) {
      await expect(
        admin.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT private.record_manual_attendance(${f.managerId}::uuid,${f.eventId}::uuid,${guest.id}::uuid,true,'no_account')`;
        })
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("limits signed-in members per member, so a shared address never blocks them, and purges old attempts", async () => {
    const shared = "198.18.40.7";
    const events = [];
    for (let i = 0; i < 12; i++)
      events.push(
        (await createFixture(admin, { status: "published" })).eventId
      );
    const crowd = [];
    for (let i = 0; i < 8; i++) crowd.push(await member());
    const codes = [];
    for (const x of crowd)
      codes.push(
        (
          await call("register_event_member", [
            x.id,
            events[0],
            "register",
            shared,
          ])
        ).code
      );
    expect(codes).toEqual(Array(8).fill("SUCCESS"));
    // One member: ten attempts in ten minutes, then refused.
    const busy = await member();
    const own = [];
    for (const event of events.slice(0, 11))
      own.push(
        (
          await call("register_event_member", [
            busy.id,
            event,
            "register",
            shared,
          ])
        ).code
      );
    expect(own).toEqual([...Array(10).fill("SUCCESS"), "RATE_LIMITED"]);
    // Guests: twenty per address per ten minutes.
    const guestIp = "198.18.41.9";
    const guests = [];
    for (let i = 0; i < 21; i++)
      guests.push(
        (
          await registration(
            runtime,
            events[1],
            `g${i}-${randomUUID()}@example.test`,
            "register",
            guestIp
          )
        ).code
      );
    expect(guests).toEqual([...Array(20).fill("SUCCESS"), "RATE_LIMITED"]);
    // Attempts older than an hour are purged by the next registration.
    await admin`INSERT INTO public.registration_attempts (ip_address, created_at) VALUES ('198.18.42.1', now() - interval '2 hours')`;
    await admin`INSERT INTO private.member_registration_attempts (member_id, created_at) VALUES (${busy.id}, now() - interval '2 hours')`;
    await registration(
      runtime,
      events[2],
      `late-${randomUUID()}@example.test`,
      "register",
      "198.18.42.2"
    );
    const [old] = await admin`SELECT
      (SELECT count(*) FROM public.registration_attempts WHERE created_at < now() - interval '1 hour')::int AS ips,
      (SELECT count(*) FROM private.member_registration_attempts WHERE created_at < now() - interval '1 hour')::int AS members`;
    expect(old).toEqual({ ips: 0, members: 0 });
    await expect(
      runtime`SELECT * FROM private.member_registration_attempts`
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("audits what actually changed on an event and reports the schema version", async () => {
    const f = await createFixture(admin, { status: "draft" });
    const [event] =
      await admin`SELECT * FROM public.events WHERE id=${f.eventId}`;
    const saved = await call("save_event_details", [
      f.managerId,
      f.eventId,
      null,
      event.revision,
      event.title,
      event.description,
      event.event_date,
      event.location,
      event.capacity,
      null,
      true,
    ]);
    expect(saved.code).toBe("SUCCESS");
    const [audit] =
      await admin`SELECT changes FROM private.uc02_audit WHERE event_id=${f.eventId} AND action='event.updated' AND changes ? 'phoneRequiredChanged'`;
    expect(audit.changes).toEqual({
      coverChanged: false,
      phoneRequiredChanged: true,
      phoneRequired: true,
    });
    expect(
      (await runtime`SELECT private.core_schema_version() AS v`)[0].v
    ).toBe(30);
  });

  it("keeps attendance lists/counts/exports scoped, private, filtered, alphabetical and paginated", async () => {
    const f = await createFixture(admin, { status: "published" });
    const m = await member();
    const second = await member();
    await signedRegistration(m.id, f.eventId);
    await signedRegistration(second.id, f.eventId);
    for (const name of ["Zahra Synthetic", "Ahmed Synthetic"])
      await call("register_event_guest", [
        f.eventId,
        name,
        `${name.split(" ")[0].toLowerCase()}-${randomUUID()}@example.test`,
        "register",
        ip(),
        null,
      ]);
    await open(f.managerId, f.eventId);
    await confirm(m.id, f.eventId, await liveCode(f.managerId, f.eventId));
    expect(
      (
        await call("list_event_attendance", [
          f.otherManagerId,
          f.eventId,
          "all",
          "",
          0,
          51,
          false,
        ])
      ).code
    ).toBe("NOT_FOUND");
    const page = (offset: number, limit: number) =>
      call("list_event_attendance", [
        f.managerId,
        f.eventId,
        "all",
        "",
        offset,
        limit,
        false,
      ]);
    const all = await page(0, 51);
    expect(all.total).toBe(4);
    expect(all.confirmed).toBe(4);
    expect(all.attended).toBe(1);
    expect(all.rows.map((r: { name: string }) => r.name)).toEqual([
      "Ahmed Synthetic",
      "Synthetic Member",
      "Synthetic Member",
      "Zahra Synthetic",
    ]);
    expect(all.rows.map((r: { hasAccount: boolean }) => r.hasAccount)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    const attendedRow = all.rows.find((r: { attended: boolean }) => r.attended);
    expect(attendedRow.method).toBe("qr");
    const first = await page(0, 1);
    const next = await page(1, 1);
    expect(first.rows).toHaveLength(1);
    expect(next.rows).toHaveLength(1);
    expect(first.rows[0].id).toBe(all.rows[0].id);
    expect(next.rows[0].id).toBe(all.rows[1].id);
    expect((await page(-1, 1)).code).toBe("VALIDATION_ERROR");
    const absent = await call("list_event_attendance", [
      f.managerId,
      f.eventId,
      "absent",
      second.email,
      0,
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
      0,
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
    for (const internal of [
      `private.register_for_event_seat(${"'" + f.eventId + "'"}::uuid,'A','a@example.test','register')`,
      `private.link_member_registration('${m.id}'::uuid,'${f.eventId}'::uuid)`,
      `private.checkin_code('${secret}',1)`,
    ])
      await expect(runtime.unsafe(`SELECT ${internal}`)).rejects.toMatchObject({
        code: "42501",
      });
  });
});
