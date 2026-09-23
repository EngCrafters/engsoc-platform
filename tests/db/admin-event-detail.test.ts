import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, close, createFixture, runtimeDb } from "./helpers";

type DetailRow = {
  id: string;
  title: string;
  committee_id: string;
  committee_name: string;
  revision: number;
  confirmed_count: number;
};

describe("UC-02 manager-scoped admin event detail", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  const list = (actorId: string) =>
    runtime<{ id: string }[]>`
      SELECT id FROM private.list_admin_events(
        ${actorId}::uuid, NULL::uuid, 'all'::text, NULL::timestamptz, NULL::uuid, 21
      )
    `;

  const detail = (actorId: string, eventId: string) =>
    runtime<DetailRow[]>`
      SELECT id, title, committee_id, committee_name, revision, confirmed_count
      FROM private.get_admin_event(${actorId}::uuid, ${eventId}::uuid)
    `;

  it("opens every event the list shows the same manager (list/detail parity)", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await admin`
      INSERT INTO public.events (title, description, event_date, committee_id, status)
      SELECT 'Parity ' || g, 'Parity description.', now() + (g || ' days')::interval, ${fixture.committeeId}, 'draft'
      FROM generate_series(1, 3) g
    `;
    const listed = await list(fixture.managerId);
    expect(listed.length).toBeGreaterThanOrEqual(4);
    for (const { id } of listed) {
      const rows = await detail(fixture.managerId, id);
      expect(rows, `event ${id} listed but not openable`).toHaveLength(1);
      expect(rows[0].id).toBe(id);
    }
  });

  it("returns the full event with committee name and real registration counts", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await admin`
      INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
      VALUES (${fixture.eventId}, 'Detail Attendee', 'detail@example.test', 'confirmed')
    `;
    const [row] = await detail(fixture.managerId, fixture.eventId);
    expect(row).toMatchObject({
      id: fixture.eventId,
      committee_id: fixture.committeeId,
      committee_name: `Committee ${fixture.committeeId}`,
      title: "UC-02 test event",
      confirmed_count: 1,
    });
  });

  it("returns nothing for a foreign committee's event", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(await detail(fixture.otherManagerId, fixture.eventId)).toHaveLength(
      0
    );
  });

  it("returns nothing for a nonexistent event or an unknown actor", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(await detail(fixture.managerId, randomUUID())).toHaveLength(0);
    expect(await detail(randomUUID(), fixture.eventId)).toHaveLength(0);
  });

  it("stops returning the event as soon as the grant is revoked", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    expect(await detail(fixture.reviewerId, fixture.eventId)).toHaveLength(1);
    await admin`
      UPDATE public.committee_managers
      SET revoked_at = now(), revoked_by = ${fixture.managerId}
      WHERE user_id = ${fixture.reviewerId} AND committee_id = ${fixture.committeeId}
    `;
    expect(await detail(fixture.reviewerId, fixture.eventId)).toHaveLength(0);
    expect(await list(fixture.reviewerId)).toHaveLength(0);
  });

  it("is executable by app_runtime only, not anon or authenticated", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    const connection = await admin.reserve();
    try {
      for (const role of ["anon", "authenticated"]) {
        await connection.unsafe(`SET ROLE ${role}`);
        try {
          await expect(
            connection.unsafe(
              `SELECT * FROM private.get_admin_event('${fixture.managerId}', '${fixture.eventId}')`
            )
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await connection.unsafe("RESET ROLE");
        }
      }
    } finally {
      connection.release();
    }
  });
});
