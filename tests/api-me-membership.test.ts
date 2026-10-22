import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /v1/me/membership (ADR 0019): the signed-in visitor's own membership.
 * Supabase Auth verifies the Bearer token; the database answers for that
 * identity only. Database behaviour is in tests/db/membership-accounts.test.ts.
 */

const state = vi.hoisted(() => ({ getUser: vi.fn(), own: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: state.getUser } }),
}));
vi.mock("@/lib/membership/db", () => ({
  ownMembershipThroughRoutine: state.own,
}));

const { GET, OPTIONS } = await import("@/app/v1/me/membership/route");

const ORIGIN = "https://essqu.com";
const USER = "33333333-3333-4333-8333-333333333333";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://api.essqu.com/v1/me/membership", {
    headers: { origin: ORIGIN, authorization: `Bearer ${JWT}`, ...headers },
  });

beforeEach(() => {
  vi.stubEnv("CORE_API_ALLOWED_ORIGINS", ORIGIN);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  state.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: USER } }, error: null });
  state.own.mockReset().mockResolvedValue({
    code: "SUCCESS",
    member: null,
    application: {
      status: "verified",
      submittedAt: "2026-10-20T10:00:00.000Z",
      decidedAt: null,
      activated: false,
    },
  });
});

describe("GET /v1/me/membership", () => {
  it("answers for the identity Supabase verified, and only with status and dates", async () => {
    const response = await GET(
      request({ "x-user-id": "99999999-9999-4999-8999-999999999999" })
    );
    expect(response.status).toBe(200);
    expect(state.getUser).toHaveBeenCalledWith(JWT);
    expect(state.own).toHaveBeenCalledWith(USER);
    expect(await response.json()).toEqual({
      data: {
        emailConfirmed: true,
        member: null,
        application: {
          status: "verified",
          submittedAt: "2026-10-20T10:00:00.000Z",
          decidedAt: null,
          activated: false,
        },
      },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("reports an active member", async () => {
    state.own.mockResolvedValue({
      code: "SUCCESS",
      member: { status: "member", since: "2026-11-01T08:00:00.000Z" },
      application: null,
    });
    expect((await (await GET(request())).json()).data.member).toEqual({
      status: "member",
      since: "2026-11-01T08:00:00.000Z",
    });
  });

  it("shows nothing for an unconfirmed email", async () => {
    state.own.mockResolvedValue({ code: "EMAIL_UNCONFIRMED" });
    expect((await (await GET(request())).json()).data).toEqual({
      emailConfirmed: false,
      member: null,
      application: null,
    });
  });

  it("refuses a missing, malformed or rejected token without asking the database", async () => {
    expect((await GET(request({ authorization: "" }))).status).toBe(401);
    expect(
      (await GET(request({ authorization: "Bearer essq_live_prefix_secret" })))
        .status
    ).toBe(401);
    state.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 403 },
    });
    const refused = await GET(request());
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe("Bearer");
    expect(state.own).not.toHaveBeenCalled();
  });

  it("does not confuse an Auth outage or a database failure with being signed out", async () => {
    state.getUser.mockRejectedValue(new TypeError("fetch failed"));
    expect((await GET(request())).status).toBe(503);
    state.getUser.mockResolvedValue({
      data: { user: { id: USER } },
      error: null,
    });
    state.own.mockRejectedValue(new Error("db down"));
    expect((await GET(request())).status).toBe(503);
  });

  it("refuses a foreign origin, and allows Authorization only on this route's preflight", async () => {
    expect(
      (await GET(request({ origin: "https://evil.example" }))).status
    ).toBe(403);
    const preflight = OPTIONS(
      new Request("https://api.essqu.com/v1/me/membership", {
        method: "OPTIONS",
        headers: { origin: ORIGIN, "access-control-request-method": "GET" },
      })
    );
    expect(preflight.headers.get("access-control-allow-methods")).toBe(
      "GET, OPTIONS"
    );
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "Authorization, X-Request-Id"
    );
  });
});
