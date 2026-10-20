import { afterAll, describe, expect, it } from "vitest";
import { adminDb, close, createFixture, runtimeDb } from "./helpers";

type PublicRow = { id: string; availability: string; committee_name: string };

describe("public event read routines", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(async () => close(admin, runtime));

  it("returns only a safe derived DTO and keeps unpublished events unavailable", async () => {
    // Keep this fixture on the first discovery page independently of earlier suites.
    const visible = await createFixture(admin, {
      status: "published",
      eventDate: new Date(Date.now() + 3600_000),
    });
    const hidden = await createFixture(admin, { status: "draft" });

    const rows = await runtime<PublicRow[]>`
      select * from private.list_public_events('upcoming', null, null, 20)
    `;
    expect(rows).toContainEqual(
      expect.objectContaining({ id: visible.eventId, availability: "open" })
    );
    expect(rows.some((row) => row.id === hidden.eventId)).toBe(false);

    const detail = await runtime<PublicRow[]>`
      select * from private.get_public_event(${visible.eventId}::uuid)
    `;
    expect(detail).toEqual([
      expect.objectContaining({
        id: visible.eventId,
        committee_name: expect.any(String),
      }),
    ]);
    await expect(
      runtime`SELECT * FROM private.get_public_event(${hidden.eventId}::uuid)`
    ).resolves.toEqual([]);
  });

  it("derives waitlist and closed without returning counts or capacity", async () => {
    const full = await createFixture(admin, { status: "full" });
    const past = await createFixture(admin, {
      status: "published",
      eventDate: new Date(Date.now() - 60_000),
    });
    const [fullRow] = await runtime<
      PublicRow[]
    >`SELECT * FROM private.get_public_event(${full.eventId}::uuid)`;
    const [pastRow] = await runtime<
      PublicRow[]
    >`SELECT * FROM private.get_public_event(${past.eventId}::uuid)`;
    expect(fullRow.availability).toBe("waitlist");
    expect(pastRow.availability).toBe("closed");
  });
});
