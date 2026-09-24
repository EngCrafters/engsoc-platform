import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  callRoutine,
  close,
  createFixture,
  runtimeDb,
} from "./helpers";

describe("M8 scoped state and count invariants", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(async () => close(admin, runtime));

  it("agrees on status and registrations in list, detail, public, and export, then revokes every read", async () => {
    const fixture = await createFixture(admin, {
      status: "published",
      capacity: 3,
    });
    await admin`
      INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
      VALUES
        (${fixture.eventId}, 'First attendee', 'first@example.test', 'confirmed'),
        (${fixture.eventId}, 'Second attendee', 'second@example.test', 'confirmed'),
        (${fixture.eventId}, 'Waitlisted attendee', 'wait@example.test', 'waitlisted')
    `;
    const [listed] = await runtime<
      {
        id: string;
        status: string;
        confirmed_count: number;
        waitlisted_count: number;
      }[]
    >`SELECT * FROM private.list_admin_events(${fixture.managerId}, ${fixture.committeeId}, 'published', NULL, NULL, 21)`;
    const [detail] = await runtime<
      { status: string; confirmed_count: number; waitlisted_count: number }[]
    >`SELECT * FROM private.get_admin_event(${fixture.managerId}, ${fixture.eventId})`;
    const [counts] = await runtime<
      { confirmed_count: number; waitlisted_count: number }[]
    >`SELECT * FROM private.count_admin_registrations(${fixture.managerId}, ${fixture.eventId})`;
    const confirmed = await runtime<{ id: string }[]>`
      SELECT * FROM private.list_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed', NULL, NULL, 51)
    `;
    const exported = await runtime<{ id: string }[]>`
      SELECT * FROM private.export_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed')
    `;
    const [publicEvent] = await runtime<{ id: string; availability: string }[]>`
      SELECT * FROM private.get_public_event(${fixture.eventId})
    `;
    expect(listed.status).toBe("published");
    expect(detail.status).toBe(listed.status);
    expect(publicEvent.id).toBe(listed.id);
    expect(publicEvent.availability).toBe("waitlist");
    expect(listed.confirmed_count).toBe(2);
    expect(detail.confirmed_count).toBe(listed.confirmed_count);
    expect(counts.confirmed_count).toBe(detail.confirmed_count);
    expect(confirmed.map((row) => row.id)).toEqual(
      exported.map((row) => row.id)
    );
    expect(confirmed).toHaveLength(counts.confirmed_count);
    expect(detail.waitlisted_count).toBe(counts.waitlisted_count);

    await admin`
      UPDATE public.committee_managers SET revoked_at = now(), revoked_by = ${fixture.reviewerId}
      WHERE user_id = ${fixture.managerId} AND committee_id = ${fixture.committeeId}
    `;
    expect(
      await runtime`SELECT * FROM private.get_admin_event(${fixture.managerId}, ${fixture.eventId})`
    ).toEqual([]);
    expect(
      await runtime`SELECT * FROM private.count_admin_registrations(${fixture.managerId}, ${fixture.eventId})`
    ).toEqual([]);
    expect(
      await runtime`SELECT * FROM private.list_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed', NULL, NULL, 51)`
    ).toEqual([]);
    expect(
      await runtime`SELECT * FROM private.export_admin_registrations(${fixture.managerId}, ${fixture.eventId}, 'confirmed')`
    ).toEqual([]);
  });

  it("hides archived past events publicly while retaining their manager record and restores visibility", async () => {
    const fixture = await createFixture(admin, {
      status: "published",
      eventDate: new Date(Date.now() - 86_400_000),
    });
    expect(
      await runtime`SELECT * FROM private.get_public_event(${fixture.eventId})`
    ).toHaveLength(1);
    expect(
      await callRoutine(runtime, "archive_event", [
        fixture.managerId,
        fixture.eventId,
        1,
      ])
    ).toMatchObject({ code: "SUCCESS" });
    expect(
      await runtime`SELECT * FROM private.get_public_event(${fixture.eventId})`
    ).toEqual([]);
    const [archived] = await runtime<{ archived_at: string | null }[]>`
      SELECT * FROM private.get_admin_event(${fixture.managerId}, ${fixture.eventId})
    `;
    expect(archived.archived_at).not.toBeNull();
    const [scope] = await runtime<{ archived_count: number }[]>`
      SELECT * FROM private.count_admin_events(${fixture.managerId}, ${fixture.committeeId})
    `;
    expect(scope.archived_count).toBe(1);
    expect(
      await callRoutine(runtime, "restore_event", [
        fixture.managerId,
        fixture.eventId,
        2,
      ])
    ).toMatchObject({ code: "SUCCESS" });
    expect(
      await runtime`SELECT * FROM private.get_public_event(${fixture.eventId})`
    ).toHaveLength(1);
  });
});
