import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  close,
  createFixture,
  registration,
  runtimeDb,
} from "./helpers";

describe("M7 admin registration operations", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(async () => close(admin, runtime));

  it("scopes list/count/export and promotes FIFO waitlist entries", async () => {
    const fixture = await createFixture(admin, {
      status: "published",
      capacity: 1,
    });
    const first = await registration(
      admin,
      fixture.eventId,
      `first-${fixture.eventId}@example.test`
    );
    const second = await registration(
      admin,
      fixture.eventId,
      `second-${fixture.eventId}@example.test`,
      "join_waitlist"
    );
    expect(first.code).toBe("SUCCESS");
    expect(second.code).toBe("WAITLISTED");

    const listed = await runtime<
      { id: string; attendee_email: string; status: string }[]
    >`
      SELECT * FROM private.list_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'waitlisted', null, null, 51)
    `;
    expect(listed).toHaveLength(1);
    expect(listed[0].attendee_email).toContain("second-");
    expect(listed[0].status).toBe("waitlisted");

    const foreign = await runtime<{ id: string }[]>`
      SELECT * FROM private.list_admin_registrations(${fixture.otherManagerId}, ${fixture.eventId}, 'waitlisted', null, null, 51)
    `;
    expect(foreign).toHaveLength(0);
    const malformed = await runtime<{ id: string }[]>`
      SELECT * FROM private.list_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'bogus', null, null, 51)
    `;
    expect(malformed).toHaveLength(0);

    const [counts] = await runtime<
      { confirmed_count: number; waitlisted_count: number }[]
    >`
      SELECT * FROM private.count_admin_registrations(${fixture.managerId}, ${fixture.eventId})
    `;
    expect(counts).toEqual({ confirmed_count: 1, waitlisted_count: 1 });

    await admin`UPDATE public.events SET capacity = 2 WHERE id = ${fixture.eventId}`;
    const [promoted] = await runtime<[{ result: { code: string } }]>`
      SELECT private.promote_waitlist(${fixture.managerId}, ${fixture.eventId}, ${second.registrationId!}, true) AS result
    `;
    expect(promoted.result.code).toBe("SUCCESS");

    const exported = await runtime<
      { attendee_email: string; status: string }[]
    >`
      SELECT * FROM private.export_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed')
    `;
    expect(exported).toHaveLength(2);
    expect(exported.every((row) => row.status === "confirmed")).toBe(true);
    expect(
      await admin`SELECT action FROM private.uc02_audit WHERE event_id = ${fixture.eventId} AND action = 'registrations.exported'`
    ).toHaveLength(1);
  });
});
