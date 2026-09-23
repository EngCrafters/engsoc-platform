import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: { execute: state.execute } }));

import { getAdminEvent } from "../lib/admin-events/server";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const EVENT = "4823273a-9fe0-4f42-8520-a4388af24393";

const row = {
  id: EVENT,
  title: "Workshop 05: CAD fundamentals",
  description: "A hands-on session.",
  event_date: "2026-12-01T09:00:00.000Z",
  location: "Main Hall",
  committee_id: "b314c2af-3df1-4be0-9b7b-e9be36a75a72",
  committee_name: "Events",
  status: "published",
  capacity: 10,
  revision: 3,
  archived_at: null,
  review_required: false,
  flagged_by: null,
  approved_by: null,
  confirmed_count: 4,
  waitlisted_count: 1,
};

describe("getAdminEvent", () => {
  beforeEach(() => state.execute.mockReset());

  it("maps a routine row to the admin DTO without dropping it", async () => {
    state.execute.mockResolvedValue([row]);
    await expect(getAdminEvent(ACTOR, EVENT)).resolves.toEqual({
      id: EVENT,
      title: "Workshop 05: CAD fundamentals",
      description: "A hands-on session.",
      eventDate: "2026-12-01T09:00:00.000Z",
      location: "Main Hall",
      committeeId: "b314c2af-3df1-4be0-9b7b-e9be36a75a72",
      committeeName: "Events",
      status: "published",
      capacity: 10,
      revision: 3,
      archivedAt: null,
      reviewRequired: false,
      flaggedBy: null,
      approvedBy: null,
      confirmedCount: 4,
      waitlistedCount: 1,
    });
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("returns null when the routine finds no in-scope event (foreign or nonexistent)", async () => {
    state.execute.mockResolvedValue([]);
    await expect(getAdminEvent(ACTOR, EVENT)).resolves.toBeNull();
  });

  it("treats a malformed id as not found without touching the database", async () => {
    for (const bad of [
      "not-a-uuid",
      "",
      "4823273a-9fe0-4f42-8520-a4388af24393'; DROP TABLE events;--",
      "../../etc/passwd",
    ]) {
      await expect(getAdminEvent(ACTOR, bad)).resolves.toBeNull();
    }
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("passes the id and actor through unchanged", async () => {
    state.execute.mockResolvedValue([]);
    await getAdminEvent(ACTOR, EVENT.toUpperCase());
    expect(state.execute).toHaveBeenCalledTimes(1);
  });
});
