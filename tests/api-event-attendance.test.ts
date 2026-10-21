import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: vi.fn(),
  phone: vi.fn(),
  event: vi.fn(),
  register: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: state.getUser } }),
}));
vi.mock("@/lib/event-management/server", () => ({
  memberProfile: state.profile,
  updatePhone: state.phone,
  memberEvent: state.event,
  registerMember: state.register,
  confirmAttendance: state.confirm,
}));
// GET /v1/me/profile now reads the whole own profile (ADR 0023).
vi.mock("@/lib/members/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/members/profile")>()),
  ownProfile: state.profile,
  updateOwnProfile: vi.fn(),
}));
const profile = await import("../app/v1/me/profile/route");
const attendance =
  await import("../app/v1/me/events/[eventId]/attendance/route");
const registration =
  await import("../app/v1/me/events/[eventId]/registrations/route");
const USER = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";
const ctx = { params: Promise.resolve({ eventId: EVENT }) };
function request(
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return new Request("https://api.essqu.com/v1/me/profile", {
    method,
    headers: {
      origin: "https://essqu.com",
      authorization: `Bearer ${JWT}`,
      "content-type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CORE_API_ALLOWED_ORIGINS", "https://essqu.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic");
  state.getUser.mockResolvedValue({
    data: { user: { id: USER } },
    error: null,
  });
  state.profile.mockResolvedValue({
    code: "SUCCESS",
    name: "Synthetic",
    email: "synthetic@example.test",
    phone: null,
  });
  state.phone.mockResolvedValue({
    code: "SUCCESS",
    name: "Synthetic",
    email: "synthetic@example.test",
    phone: "+96891234567",
  });
  state.event.mockResolvedValue({
    code: "SUCCESS",
    registration: null,
    checkinOpen: true,
  });
  state.register.mockResolvedValue({ code: "SUCCESS" });
  state.confirm.mockResolvedValue({
    code: "SUCCESS",
    checkedInAt: "2026-10-20T10:00:00Z",
  });
});
describe("member event API boundaries", () => {
  it("uses only the identity verified by Supabase and keeps profiles private/no-store", async () => {
    const response = await profile.GET(
      request("GET", undefined, { "x-user-id": "forged" })
    );
    expect(response.status).toBe(200);
    expect(state.profile).toHaveBeenCalledWith(USER);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(
      (
        await profile.GET(
          request("GET", undefined, {
            authorization: "Bearer essq_live_not_a_session",
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await profile.GET(
          request("GET", undefined, { origin: "https://evil.test" })
        )
      ).status
    ).toBe(403);
  });
  it("allows only a valid own phone update and rejects identity/membership fields", async () => {
    expect(
      (await profile.PATCH(request("PATCH", { phone: "+968 9123 4567" })))
        .status
    ).toBe(200);
    expect(state.phone).toHaveBeenCalledWith(USER, "+96891234567");
    for (const body of [
      { phone: "91234567" },
      { phone: "+96891234567", userId: EVENT },
      { memberId: EVENT },
      null,
      [],
    ])
      expect((await profile.PATCH(request("PATCH", body))).status).toBe(422);
    expect(state.phone).toHaveBeenCalledTimes(1);
  });
  it("never records attendance on GET, rejects missing/unsafe challenges and denies invalid sessions", async () => {
    expect((await attendance.GET(request(), ctx)).status).toBe(200);
    expect(state.confirm).not.toHaveBeenCalled();
    for (const body of [
      {},
      { challenge: "invalid" },
      { challenge: "a".repeat(64), memberId: USER },
      null,
    ])
      expect((await attendance.POST(request("POST", body), ctx)).status).toBe(
        409
      );
    expect(state.confirm).not.toHaveBeenCalled();
    expect(
      (
        await attendance.POST(
          request("POST", { challenge: "a".repeat(64) }),
          ctx
        )
      ).status
    ).toBe(200);
    expect(state.confirm).toHaveBeenCalledWith(USER, EVENT, "a".repeat(64));
    state.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    expect(
      (
        await attendance.POST(
          request("POST", { challenge: "a".repeat(64) }),
          ctx
        )
      ).status
    ).toBe(401);
  });
  it("preserves explicit eligibility failures and reports dependency outages without bypass", async () => {
    for (const code of [
      "CHECKIN_CLOSED",
      "INVALID_CHALLENGE",
      "CHALLENGE_EXPIRED",
      "NOT_REGISTERED",
      "WAITLISTED",
    ]) {
      state.confirm.mockResolvedValue({ code });
      const response = await attendance.POST(
        request("POST", { challenge: "a".repeat(64) }),
        ctx
      );
      expect(response.status).toBe(409);
      expect((await response.json()).errors[0].code).toBe(code);
    }
    state.profile.mockResolvedValue({ code: "MEMBER_REQUIRED" });
    expect((await profile.GET(request())).status).toBe(403);
    state.profile.mockRejectedValue(new Error("missing migration SQL secret"));
    const failed = await profile.GET(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("SQL secret");
  });
  it("takes only member registration intent and never trusts submitted name/email/member IDs", async () => {
    const headers = { "x-vercel-forwarded-for": "198.51.100.110" };
    expect(
      (
        await registration.POST(
          request("POST", { intent: "register" }, headers),
          ctx
        )
      ).status
    ).toBe(201);
    expect(state.register).toHaveBeenCalledWith(USER, EVENT, "register");
    // No client address is needed for a signed-in member (ADR 0022).
    expect(
      (await registration.POST(request("POST", { intent: "register" }), ctx))
        .status
    ).toBe(201);
    for (const extra of [
      "attendeeName",
      "attendeeEmail",
      "memberId",
      "ipAddress",
    ]) {
      expect(
        (
          await registration.POST(
            request("POST", { intent: "register", [extra]: "forged" }, headers),
            ctx
          )
        ).status
      ).toBe(422);
    }
    expect(state.register).toHaveBeenCalledTimes(2);
    state.register.mockResolvedValue({ code: "RATE_LIMITED" });
    const limited = await registration.POST(
      request("POST", { intent: "register" }, headers),
      ctx
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
  });
  it("allows bearer/JSON preflight only for the configured website", () => {
    const response = attendance.OPTIONS(request("OPTIONS"));
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Authorization"
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST"
    );
    expect(
      attendance
        .OPTIONS(request("OPTIONS", undefined, { origin: "https://evil.test" }))
        .headers.get("access-control-allow-origin")
    ).toBeNull();
  });
});
