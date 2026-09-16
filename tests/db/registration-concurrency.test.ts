import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  callRoutine,
  close,
  createFixture,
  registration,
  runtimeDb,
} from "./helpers";

describe("UC-02 registration integrity", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  it("normalizes email and preserves one active registration", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "  Person@Example.Test ",
        "register",
        "198.51.100.101"
      )
    ).toMatchObject({
      code: "SUCCESS",
    });
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "person@example.test",
        "register",
        "198.51.100.102"
      )
    ).toMatchObject({
      code: "ALREADY_REGISTERED",
    });
    const rows =
      await admin`SELECT attendee_email FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    expect(rows).toEqual([{ attendee_email: "person@example.test" }]);
  });

  it("prevents simultaneous duplicate submissions at the routine boundary", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    const first = runtimeDb();
    const second = runtimeDb();
    try {
      const results = await Promise.all([
        registration(
          first,
          fixture.eventId,
          "race@example.test",
          "register",
          "198.51.100.103"
        ),
        registration(
          second,
          fixture.eventId,
          "RACE@EXAMPLE.TEST",
          "register",
          "198.51.100.103"
        ),
      ]);
      expect(results.map((result) => result.code).sort()).toEqual([
        "ALREADY_REGISTERED",
        "SUCCESS",
      ]);
      const rows =
        await admin`SELECT count(*)::int AS count FROM public.registrations WHERE event_id = ${fixture.eventId}`;
      expect(rows[0].count).toBe(1);
    } finally {
      await close(first, second);
    }
  });

  it("prevents capacity oversubscription under concurrent independent registrations", async () => {
    const fixture = await createFixture(admin, {
      status: "published",
      capacity: 1,
    });
    const first = runtimeDb();
    const second = runtimeDb();
    try {
      const results = await Promise.all([
        registration(
          first,
          fixture.eventId,
          "one@example.test",
          "register",
          "198.51.100.104"
        ),
        registration(
          second,
          fixture.eventId,
          "two@example.test",
          "register",
          "198.51.100.105"
        ),
      ]);
      expect(results.map((result) => result.code).sort()).toEqual([
        "EVENT_FULL",
        "SUCCESS",
      ]);
      const rows = await admin`
        SELECT count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed
        FROM public.registrations WHERE event_id = ${fixture.eventId}
      `;
      expect(rows[0].confirmed).toBe(1);
    } finally {
      await close(first, second);
    }
  });

  it("maintains FIFO waitlist promotion and capacity invariants", async () => {
    const fixture = await createFixture(admin, {
      status: "published",
      capacity: 1,
    });
    expect(
      await registration(
        runtime,
        fixture.eventId,
        "confirmed@example.test",
        "register",
        "198.51.100.106"
      )
    ).toMatchObject({
      code: "SUCCESS",
    });
    const first = await registration(
      runtime,
      fixture.eventId,
      "first@example.test",
      "join_waitlist",
      "198.51.100.107"
    );
    const second = await registration(
      runtime,
      fixture.eventId,
      "second@example.test",
      "join_waitlist",
      "198.51.100.108"
    );
    expect(first.code).toBe("WAITLISTED");
    expect(second.code).toBe("WAITLISTED");

    await admin`UPDATE public.events SET capacity = 2 WHERE id = ${fixture.eventId}`;
    expect(
      await callRoutine(runtime, "promote_waitlist", [
        fixture.managerId,
        fixture.eventId,
        second.registrationId!,
        true,
      ])
    ).toMatchObject({ code: "QUEUE_ORDER_CONFLICT" });
    expect(
      await callRoutine(runtime, "promote_waitlist", [
        fixture.managerId,
        fixture.eventId,
        first.registrationId!,
        false,
      ])
    ).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      await callRoutine(runtime, "promote_waitlist", [
        fixture.managerId,
        fixture.eventId,
        first.registrationId!,
        true,
      ])
    ).toMatchObject({ code: "SUCCESS" });
    const rows = await admin`
      SELECT attendee_email, status FROM public.registrations
      WHERE event_id = ${fixture.eventId} ORDER BY attendee_email
    `;
    expect(rows).toContainEqual({
      attendee_email: "first@example.test",
      status: "confirmed",
    });
    expect(rows).toContainEqual({
      attendee_email: "second@example.test",
      status: "waitlisted",
    });
  });
});
