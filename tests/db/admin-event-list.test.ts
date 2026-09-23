import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { adminDb, close, createFixture, runtimeDb } from "./helpers";

type AdminListRow = {
  id: string;
  title: string;
  committee_name: string;
  confirmed_count: number;
  waitlisted_count: number;
};

describe("UC-02 manager-scoped admin event list", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  async function list(
    actorId: string,
    options: {
      committeeId?: string | null;
      status?: string;
      cursorDate?: string | null;
      cursorId?: string | null;
    } = {}
  ) {
    return runtime<AdminListRow[]>`
      SELECT id, title, committee_name, confirmed_count, waitlisted_count
      FROM private.list_admin_events(
        ${actorId}::uuid,
        ${options.committeeId ?? null}::uuid,
        ${options.status ?? "all"}::text,
        ${options.cursorDate ?? null}::timestamptz,
        ${options.cursorId ?? null}::uuid,
        21
      )
    `;
  }

  it("returns only the manager's committee, filters lifecycle rows, paginates, and aggregates no PII", async () => {
    const fixture = await createFixture(admin);
    const base = Date.now() + 172_800_000;
    const ids = Array.from({ length: 22 }, () => randomUUID());
    for (const [index, id] of ids.entries()) {
      await admin`
        INSERT INTO public.events (id, title, description, event_date, committee_id, status, capacity)
        VALUES (${id}, ${`List event ${index}`}, 'Scoped list fixture.', ${new Date(base + index * 60_000)}, ${fixture.committeeId}, ${index === 0 ? "published" : "draft"}::public.event_status, 2)
      `;
    }
    await admin`
      INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
      VALUES
        (${ids[0]}, 'One', 'one@example.test', 'confirmed'),
        (${ids[0]}, 'Two', 'two@example.test', 'confirmed'),
        (${ids[0]}, 'Three', 'three@example.test', 'waitlisted')
    `;

    const firstPage = await list(fixture.managerId, {
      committeeId: fixture.committeeId,
    });
    expect(firstPage).toHaveLength(21);
    expect(
      firstPage.every((row) => row.committee_name.startsWith("Committee"))
    ).toBe(true);
    expect(firstPage.find((row) => row.id === ids[0])).toMatchObject({
      confirmed_count: 2,
      waitlisted_count: 1,
    });

    const last = firstPage.at(-1)!;
    const secondPage = await list(fixture.managerId, {
      committeeId: fixture.committeeId,
      cursorDate: (
        await admin<
          { event_date: string }[]
        >`SELECT event_date FROM public.events WHERE id = ${last.id}`
      )[0].event_date,
      cursorId: last.id,
    });
    expect(secondPage).toHaveLength(2);
    expect(
      secondPage.some((row) => firstPage.some((first) => first.id === row.id))
    ).toBe(false);

    const published = await list(fixture.managerId, {
      committeeId: fixture.committeeId,
      status: "published",
    });
    expect(published).toEqual([
      expect.objectContaining({
        id: ids[0],
        confirmed_count: 2,
        waitlisted_count: 1,
      }),
    ]);

    const foreign = await list(fixture.otherManagerId, {
      committeeId: fixture.committeeId,
    });
    expect(foreign).toEqual([]);
  });

  it("returns an empty result for an invalid lifecycle filter without leaking scoped rows", async () => {
    const fixture = await createFixture(admin);
    expect(await list(fixture.managerId, { status: "forged" })).toEqual([]);
  });
});
