import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  manager: vi.fn(),
  count: vi.fn(),
  exportRows: vi.fn(),
}));

vi.mock("@/lib/auth/manager", () => ({ getManagerContext: state.manager }));
vi.mock("@/lib/admin-registrations/server", () => ({
  countAdminRegistrations: state.count,
  exportAdminRegistrations: state.exportRows,
}));

import { POST } from "../app/admin/(protected)/events/[id]/registrations/export/route";

const eventId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function request(status = "confirmed") {
  return new Request(
    `https://example.test/admin/events/${eventId}/registrations/export?status=${status}`,
    { method: "POST", headers: { origin: "https://example.test" } }
  );
}

function exportRequest(req = request()) {
  return POST(req, { params: Promise.resolve({ id: eventId }) });
}

describe("registration export response", () => {
  beforeEach(() => {
    state.manager.mockReset().mockResolvedValue({ kind: "manager", userId });
    state.count.mockReset().mockResolvedValue({
      confirmed_count: 1,
      waitlisted_count: 0,
    });
    state.exportRows.mockReset().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        attendeeName: "Attendee",
        attendeeEmail: "attendee@example.test",
        status: "confirmed",
        registeredAt: "2026-09-23T12:00:00.000Z",
      },
    ]);
  });

  it("never returns a successful empty export when the database suppresses an oversized result", async () => {
    state.exportRows.mockResolvedValue([]);
    const response = await exportRequest();
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).not.toContain("text/csv");
    expect(await response.text()).toMatch(/changed or the export limit/i);
  });

  it("rejects unsupported sizes before requesting export rows", async () => {
    state.count.mockResolvedValue({
      confirmed_count: 10_001,
      waitlisted_count: 0,
    });
    const response = await exportRequest();
    expect(response.status).toBe(413);
    expect(state.exportRows).not.toHaveBeenCalled();
  });

  it("rejects malformed status instead of exporting confirmed by default", async () => {
    const response = await exportRequest(request("forged"));
    expect(response.status).toBe(400);
    expect(state.count).not.toHaveBeenCalled();
  });

  it("returns a private CSV with the authorized rows", async () => {
    const response = await exportRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("attendee@example.test");
    expect(state.exportRows).toHaveBeenCalledWith(userId, eventId, "confirmed");
  });
});
