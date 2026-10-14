import { afterAll, describe, expect, it } from "vitest";
import {
  TEST_PHONE,
  adminDb,
  callRoutine,
  close,
  createFixture,
  registration,
  runtimeDb,
} from "./helpers";

/**
 * The attendee phone contract at the database boundary.
 *
 * The TypeScript half of this rule is tests/registration-phone.test.ts. Both
 * exist because a visitor typing a number and a caller invoking the routine
 * directly must be held to the same contract, and the routine must not trust
 * whatever the application layer decided.
 */

describe("registration attendee phone", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  it("leaves a historical registration with no phone valid", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    // Exactly the shape of a row captured before migration 0024: no phone, and
    // nothing about it may be rejected or rewritten.
    await admin`
      INSERT INTO public.registrations (event_id, attendee_name, attendee_email, attendee_phone)
      VALUES (${fixture.eventId}, 'Legacy Attendee', 'legacy@example.test', NULL)
    `;
    const [row] = await admin<
      { attendee_phone: string | null }[]
    >`SELECT attendee_phone FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    expect(row.attendee_phone).toBeNull();

    // And a new registration for the same event still works alongside it.
    expect(
      await registration(runtime, fixture.eventId, "new@example.test")
    ).toMatchObject({ code: "SUCCESS" });
  });

  it("stores the canonical phone on a confirmed registration", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "confirmed@example.test",
        "register",
        "198.51.100.121",
        "  +968 9123 4567 "
      )
    ).toMatchObject({ code: "SUCCESS" });

    const [row] = await admin<
      { attendee_phone: string | null }[]
    >`SELECT attendee_phone FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    expect(row.attendee_phone).toBe("+96891234567");
  });

  it("stores the canonical phone on a waitlisted registration", async () => {
    const fixture = await createFixture(admin, {
      status: "published",
      capacity: 1,
    });
    await registration(runtime, fixture.eventId, "first@example.test");
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "waiting@example.test",
        "join_waitlist",
        "198.51.100.122",
        "(968) 9000-1111"
      )
    ).toMatchObject({ code: "WAITLISTED" });

    const [row] = await admin<
      { attendee_phone: string | null; status: string }[]
    >`SELECT attendee_phone, status::text FROM public.registrations WHERE attendee_email = 'waiting@example.test'`;
    expect(row.status).toBe("waitlisted");
    expect(row.attendee_phone).toBe("96890001111");
  });

  // Each case gets its own IP. The routine's limiter allows five attempts per
  // IP per ten minutes and counts rejected attempts too, so sharing one address
  // would turn the sixth case into RATE_LIMITED and hide what is being tested.
  it.each([
    ["a missing phone", null, "INVALID_PHONE", "198.51.100.141"],
    ["an empty phone", "", "INVALID_PHONE", "198.51.100.142"],
    ["whitespace only", "   ", "INVALID_PHONE", "198.51.100.143"],
    ["letters", "+968abc4567", "INVALID_PHONE", "198.51.100.144"],
    ["too few digits", "123456", "INVALID_PHONE", "198.51.100.145"],
    ["too many digits", "+1234567890123456", "INVALID_PHONE", "198.51.100.146"],
    ["two pluses", "++96891234567", "INVALID_PHONE", "198.51.100.147"],
    ["an embedded plus", "+968+91234567", "INVALID_PHONE", "198.51.100.148"],
    // A NUL byte cannot even be sent to Postgres (it is not valid UTF-8 in a
    // text parameter), so the database case uses a representable control
    // character. The domain suite covers NUL before it would ever get that far.
    [
      "a control character",
      "96891\u0001234",
      "INVALID_PHONE",
      "198.51.100.149",
    ],
    [
      "text wrapped around a number",
      "call 96891234567",
      "INVALID_PHONE",
      "198.51.100.150",
    ],
  ])("rejects %s", async (_label, phone, code, ip) => {
    const fixture = await createFixture(admin, { status: "published" });
    const result = await callRoutine(runtime, "register_for_event", [
      fixture.eventId,
      "Test Attendee",
      "rejected@example.test",
      phone,
      "register",
      ip,
    ]);
    expect(result).toMatchObject({ code });
    const [count] = await admin<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    expect(count.n).toBe(0);
  });

  it("accepts Arabic-Indic digits and stores ASCII", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "arabic-digits@example.test",
        "register",
        "198.51.100.124",
        // 9689123456 7, typed with U+0660..U+0669.
        "\u0669\u0666\u0668\u0669\u0661\u0662\u0663\u0664\u0665\u0666\u0667"
      )
    ).toMatchObject({ code: "SUCCESS" });
    const [row] = await admin<
      { attendee_phone: string | null }[]
    >`SELECT attendee_phone FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    expect(row.attendee_phone).toBe("96891234567");
  });

  it("preserves a leading zero, which a numeric column could not", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await registration(
      runtime,
      fixture.eventId,
      "leading-zero@example.test",
      "register",
      "198.51.100.125",
      "0912345678"
    );
    const [row] = await admin<
      { attendee_phone: string | null }[]
    >`SELECT attendee_phone FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    expect(row.attendee_phone).toBe("0912345678");
  });

  it("keeps email as the duplicate identity: a second phone does not create a second place", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "duplicate@example.test",
        "register",
        "198.51.100.126",
        "+15550100001"
      )
    ).toMatchObject({ code: "SUCCESS" });
    // Different number, same email: still one active registration, unchanged
    // from the pre-phone behaviour.
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "duplicate@example.test",
        "register",
        "198.51.100.127",
        "+15550100002"
      )
    ).toMatchObject({ code: "ALREADY_REGISTERED" });

    const rows = await admin<
      { attendee_phone: string | null }[]
    >`SELECT attendee_phone FROM public.registrations WHERE event_id = ${fixture.eventId} AND status IN ('confirmed','waitlisted')`;
    expect(rows).toHaveLength(1);
    expect(rows[0].attendee_phone).toBe("+15550100001");
  });

  it("refuses to store a non-canonical phone even from a direct writer", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    // The CHECK is the last line of defence, below both the domain helper and
    // the routine. A privileged writer still cannot introduce a half-formatted
    // number that the rest of the system would have to cope with.
    await expect(
      admin`INSERT INTO public.registrations (event_id, attendee_name, attendee_email, attendee_phone)
            VALUES (${fixture.eventId}, 'Sneaky', 'sneaky@example.test', '+968 9123 4567')`
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("leaves exactly one registration write routine after the signature change", async () => {
    const rows = await admin<{ signature: string; n: number }[]>`
      SELECT string_agg(format_type(a.t, NULL), ', ' ORDER BY a.ord) AS signature,
             count(*) OVER ()::int AS n
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      CROSS JOIN LATERAL unnest(string_to_array(p.proargtypes::text, ' ')::oid[])
        WITH ORDINALITY AS a(t, ord)
      WHERE ns.nspname = 'private' AND p.proname = 'register_for_event'
      GROUP BY p.oid
    `;
    // A replaced signature must not leave the old five-argument form behind as
    // a second, executable write path that accepts no phone at all.
    expect(rows).toHaveLength(1);
    expect(rows[0].signature).toBe("uuid, text, text, text, text, inet");
    expect(rows[0].n).toBe(1);
  });
});

describe("admin registration reads expose the phone only in scope", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  it("returns the phone to an authorized manager and nothing to an outsider", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await registration(
      runtime,
      fixture.eventId,
      "scoped@example.test",
      "register",
      "198.51.100.131",
      TEST_PHONE
    );

    const inScope = await admin<
      { attendee_phone: string | null }[]
    >`SELECT * FROM private.list_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed', NULL, NULL, 51)`;
    expect(inScope).toHaveLength(1);
    expect(inScope[0].attendee_phone).toBe(TEST_PHONE);

    // A manager of a different committee sees nothing — not the row, and so
    // certainly not the phone.
    const outOfScope = await admin<
      { attendee_phone: string | null }[]
    >`SELECT * FROM private.list_admin_registrations(${fixture.otherManagerId}, ${fixture.eventId}, 'confirmed', NULL, NULL, 51)`;
    expect(outOfScope).toHaveLength(0);
  });

  it("returns the phone in an authorized export and an empty result out of scope", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await registration(
      runtime,
      fixture.eventId,
      "exported@example.test",
      "register",
      "198.51.100.132",
      TEST_PHONE
    );

    const rows = await admin<
      { attendee_phone: string | null }[]
    >`SELECT * FROM private.export_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed')`;
    expect(rows).toHaveLength(1);
    expect(rows[0].attendee_phone).toBe(TEST_PHONE);

    const denied = await admin<
      { attendee_phone: string | null }[]
    >`SELECT * FROM private.export_admin_registrations(${fixture.otherManagerId}, ${fixture.eventId}, 'confirmed')`;
    expect(denied).toHaveLength(0);
  });

  it("exports a historical row with a null phone without inventing one", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await admin`
      INSERT INTO public.registrations (event_id, attendee_name, attendee_email, attendee_phone)
      VALUES (${fixture.eventId}, 'Legacy Attendee', 'legacy-export@example.test', NULL)
    `;
    const rows = await admin<
      { attendee_phone: string | null }[]
    >`SELECT * FROM private.export_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed')`;
    expect(rows).toHaveLength(1);
    expect(rows[0].attendee_phone).toBeNull();
  });
});
