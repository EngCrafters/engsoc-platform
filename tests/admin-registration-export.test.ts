import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const applicationOrigin = "https://engsoc-platform.vercel.app";

function request(
  status = "confirmed",
  headers: Record<string, string> = { origin: applicationOrigin },
  requestOrigin = applicationOrigin
) {
  return new Request(
    `${requestOrigin}/admin/events/${eventId}/registrations/export?status=${status}`,
    { method: "POST", headers }
  );
}

function exportRequest(req = request()) {
  return POST(req, { params: Promise.resolve({ id: eventId }) });
}

describe("registration export response", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", applicationOrigin);
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
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the canonical browser origin behind Vercel proxy headers", async () => {
    const response = await exportRequest(
      request(
        "confirmed",
        {
          origin: applicationOrigin,
          referer: `${applicationOrigin}/admin/events/${eventId}/registrations`,
          host: "engsoc-platform.vercel.app",
          "x-forwarded-host": "engsoc-platform.vercel.app",
          "x-forwarded-proto": "https",
        },
        "http://internal-runtime:3000"
      )
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ["foreign Origin", { origin: "https://evil.example" }],
    ["missing Origin", {}],
    ["opaque Origin from a no-referrer form", { origin: "null" }],
    ["invalid Origin", { origin: "not-an-origin" }],
    ["Origin containing a path", { origin: `${applicationOrigin}/admin` }],
    [
      "foreign Referer",
      { origin: applicationOrigin, referer: "https://evil.example/admin" },
    ],
    ["invalid Referer", { origin: applicationOrigin, referer: "malformed" }],
    [
      "preview Vercel host",
      { origin: "https://engsoc-platform-preview-eng-crafters.vercel.app" },
    ],
    [
      "forged matching host and Origin",
      {
        origin: "https://evil.example",
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    ],
  ] satisfies [string, Record<string, string>][])(
    "rejects %s before authorization or database reads",
    async (_name, headers) => {
      const response = await exportRequest(request("confirmed", headers));
      expect(response.status).toBe(403);
      expect(state.manager).not.toHaveBeenCalled();
      expect(state.count).not.toHaveBeenCalled();
      expect(state.exportRows).not.toHaveBeenCalled();
    }
  );

  it.each([
    undefined,
    "http://engsoc-platform.vercel.app",
    `${applicationOrigin}/admin`,
    "https://localhost",
  ])(
    "fails closed for invalid production APP_ORIGIN %s",
    async (configured) => {
      vi.stubEnv("APP_ORIGIN", configured);
      const response = await exportRequest();
      expect(response.status).toBe(403);
      expect(state.manager).not.toHaveBeenCalled();
    }
  );

  it("supports a local development origin without production configuration", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", undefined);
    expect(
      (
        await exportRequest(
          request(
            "confirmed",
            { origin: "http://localhost:3000" },
            "http://localhost:3000"
          )
        )
      ).status
    ).toBe(200);
    expect(
      (
        await exportRequest(
          request(
            "confirmed",
            { origin: "https://evil.example" },
            "https://evil.example"
          )
        )
      ).status
    ).toBe(403);
  });

  it.each(["TECHNICAL", "BOARD_ADMIN", "COMMITTEE_MANAGER"])(
    "preserves authorized %s exports",
    async (accessLevel) => {
      state.manager.mockResolvedValue({ kind: "manager", userId, accessLevel });
      expect((await exportRequest()).status).toBe(200);
      expect(state.exportRows).toHaveBeenCalledWith(
        userId,
        eventId,
        "confirmed"
      );
    }
  );

  it.each(["anonymous", "unassigned"])("denies %s identities", async (kind) => {
    state.manager.mockResolvedValue({ kind, userId });
    expect((await exportRequest()).status).toBe(401);
    expect(state.count).not.toHaveBeenCalled();
    expect(state.exportRows).not.toHaveBeenCalled();
  });

  it("denies a foreign committee event without exporting", async () => {
    state.count.mockResolvedValue(null);
    expect((await exportRequest()).status).toBe(404);
    expect(state.exportRows).not.toHaveBeenCalled();
  });

  it("rejects malformed event IDs before database calls", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
    expect(state.count).not.toHaveBeenCalled();
  });

  it("exports the selected waitlist with formula protection and attachment headers", async () => {
    state.count.mockResolvedValue({ confirmed_count: 0, waitlisted_count: 1 });
    state.exportRows.mockResolvedValue([
      {
        attendeeName: " =1+1",
        attendeeEmail: "attendee@example.test",
        status: "waitlisted",
        registeredAt: "2026-10-08T00:00:00.000Z",
      },
    ]);
    const response = await exportRequest(request("waitlisted"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("content-disposition")).toMatch(
      new RegExp(
        `^attachment; filename="registrations-${eventId}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`
      )
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain('"\' =1+1"');
    expect(state.exportRows).toHaveBeenCalledWith(
      userId,
      eventId,
      "waitlisted"
    );
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
