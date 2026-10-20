import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ manager: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/manager", () => ({ getManagerContext: state.manager }));
vi.mock("@/lib/event-management/server", () => ({
  listAttendance: state.list,
}));
const { POST } =
  await import("../app/admin/(protected)/events/[id]/attendance/export/route");
const EVENT = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: EVENT }) };
function request(origin = "https://admin.example") {
  return new Request(
    `https://admin.example/admin/events/${EVENT}/attendance/export`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: "filter=all&search=",
    }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://admin.example");
  state.manager.mockResolvedValue({
    kind: "manager",
    userId: "22222222-2222-4222-8222-222222222222",
  });
  state.list.mockResolvedValue({
    code: "SUCCESS",
    rows: [
      {
        id: EVENT,
        name: '=HYPERLINK("bad")',
        email: "member@example.test",
        status: "confirmed",
        attended: true,
        checkedInAt: "2026-10-20T10:00:00Z",
        registeredAt: "2026-10-19T10:00:00Z",
        phone: "private-must-not-export",
      },
    ],
  });
});
describe("private attendance CSV", () => {
  it("requires same-origin POST and current management scope", async () => {
    expect((await POST(request("https://evil.test"), ctx)).status).toBe(403);
    expect(state.manager).not.toHaveBeenCalled();
    state.manager.mockResolvedValue({ kind: "anonymous" });
    expect((await POST(request(), ctx)).status).toBe(401);
    state.manager.mockResolvedValue({ kind: "manager", userId: EVENT });
    state.list.mockResolvedValue({ code: "NOT_FOUND" });
    expect((await POST(request(), ctx)).status).toBe(404);
  });
  it("exports a bounded explicit projection with formula escaping and no phone leakage", async () => {
    const response = await POST(request(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await response.text();
    expect(text).toContain('"\'=HYPERLINK(""bad"")"');
    expect(text).toContain("member@example.test");
    expect(text).not.toContain("private-must-not-export");
    expect(state.list).toHaveBeenCalledWith(
      expect.any(String),
      EVENT,
      "all",
      "",
      null,
      10000,
      true
    );
  });
  it("fails safely on export limits and database outages", async () => {
    state.list.mockResolvedValue({ code: "EXPORT_LIMIT" });
    expect((await POST(request(), ctx)).status).toBe(413);
    state.list.mockRejectedValue(new Error("secret SQL"));
    const failed = await POST(request(), ctx);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret SQL");
  });
});
