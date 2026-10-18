import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level behaviour for /v1.
 *
 * These exercise the actual route handlers — origin policy, body handling,
 * status mapping, CORS on both success and failure — with the canonical domains
 * mocked. Business rules are NOT re-tested here: capacity, waitlist ordering,
 * duplicates and the rate limit live in PostgreSQL and are covered by the
 * disposable-database suites. What is proved here is that the transport maps
 * them to the published contract and refuses what it should.
 */

const state = vi.hoisted(() => ({
  authenticate: vi.fn(),
  registerForEvent: vi.fn(),
  getPublicEventPage: vi.fn(),
  getPublicEvent: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ authenticate: state.authenticate }));
vi.mock("@/lib/registrations", () => ({
  registerForEvent: state.registerForEvent,
}));
vi.mock("@/lib/events", () => ({
  getPublicEventPage: state.getPublicEventPage,
  getPublicEvent: state.getPublicEvent,
}));

const { POST, OPTIONS } =
  await import("@/app/v1/events/[eventId]/registrations/route");
const { GET: GET_LIST } = await import("@/app/v1/events/route");
const { GET: GET_DETAIL } = await import("@/app/v1/events/[eventId]/route");

const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ctx = { params: Promise.resolve({ eventId: EVENT_ID }) };

const VERCEL_IP = { "x-vercel-forwarded-for": "203.0.113.9" };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    "https://api.essqu.com/v1/events/" + EVENT_ID + "/registrations",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://essqu.com",
        ...VERCEL_IP,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );
}

const VALID = {
  attendeeName: "Visitor",
  attendeeEmail: "visitor@example.test",
};

beforeEach(() => {
  state.authenticate.mockReset();
  state.registerForEvent.mockReset();
  state.getPublicEventPage.mockReset();
  state.getPublicEvent.mockReset();
  state.authenticate.mockResolvedValue({
    ok: true,
    client: { id: "c1", name: "Landing" },
  });
  state.registerForEvent.mockResolvedValue({ ok: true });
});

describe("POST /v1/events/{id}/registrations", () => {
  it("returns 201 confirmed and never caches", async () => {
    const res = await POST(post(VALID), ctx);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://essqu.com"
    );
    expect(res.headers.get("access-control-expose-headers")).toBe(
      "X-Request-Id, Retry-After"
    );
    expect(await res.json()).toEqual({ data: { status: "confirmed" } });
  });

  it("returns 201 waitlisted", async () => {
    state.registerForEvent.mockResolvedValue({ ok: true, waitlisted: true });
    const res = await POST(post({ ...VALID, intent: "join_waitlist" }), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { status: "waitlisted" } });
  });

  it("refuses a foreign origin before doing any work", async () => {
    const res = await POST(
      post(VALID, { origin: "https://evil.example" }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-expose-headers")).toBeNull();
    expect(state.registerForEvent).not.toHaveBeenCalled();
  });

  it("refuses a vercel.app preview origin", async () => {
    const res = await POST(
      post(VALID, { origin: "https://x-preview.vercel.app" }),
      ctx
    );
    expect(res.status).toBe(403);
  });

  it("allows a request with no Origin (not a browser)", async () => {
    const request = post(VALID);
    request.headers.delete("origin");
    expect((await POST(request, ctx)).status).toBe(201);
  });

  it("refuses a non-JSON content type", async () => {
    const res = await POST(post(VALID, { "content-type": "text/plain" }), ctx);
    expect(res.status).toBe(415);
  });

  it("refuses malformed JSON", async () => {
    expect((await POST(post("{nope"), ctx)).status).toBe(400);
  });

  it("refuses an oversized body", async () => {
    const res = await POST(post({ ...VALID, pad: "x".repeat(20000) }), ctx);
    expect(res.status).toBe(413);
  });

  it("refuses a client-supplied ipAddress", async () => {
    // The client address is server-derived. Sending one is an attempt to pick
    // your own rate-limit bucket.
    const res = await POST(post({ ...VALID, ipAddress: "1.2.3.4" }), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors).toEqual([
      { field: "ipAddress", code: "unexpected-field" },
    ]);
    expect(state.registerForEvent).not.toHaveBeenCalled();
  });

  it("refuses missing fields", async () => {
    const res = await POST(post({ attendeeName: "Only Name" }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([
      { field: "attendeeEmail", code: "required" },
    ]);
  });

  it("refuses an invalid intent", async () => {
    const res = await POST(post({ ...VALID, intent: "maybe" }), ctx);
    expect(res.status).toBe(422);
  });

  it("returns 404 for a malformed event id without calling the domain", async () => {
    const res = await POST(post(VALID), {
      params: Promise.resolve({ eventId: "nope" }),
    });
    expect(res.status).toBe(404);
    expect(state.registerForEvent).not.toHaveBeenCalled();
  });

  it("passes a server-derived IP, never one from the body", async () => {
    await POST(post(VALID), ctx);
    expect(state.registerForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: "203.0.113.9", eventId: EVENT_ID })
    );
  });

  it("refuses when the client address cannot be trusted", async () => {
    const request = post(VALID);
    request.headers.delete("x-vercel-forwarded-for");
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(request, ctx);
    vi.unstubAllEnvs();
    expect(res.status).toBe(503);
    expect(state.registerForEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["event_full", 409],
    ["already_registered", 409],
    ["already_waitlisted", 409],
    ["registration_closed", 409],
    ["event_not_found", 404],
    ["event_not_published", 404],
    ["invalid_name", 422],
    ["invalid_email", 422],
    ["rate_limited", 429],
    ["server_error", 503],
    ["invalid_ip", 503],
  ] as const)("maps domain %s to %i", async (error, status) => {
    state.registerForEvent.mockResolvedValue({ ok: false, error });
    const res = await POST(post(VALID), ctx);
    expect(res.status, error).toBe(status);
    const body = await res.json();
    expect(body.code).toBeTypeOf("string");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://essqu.com"
    );
  });

  it("sets Retry-After only for rate limiting", async () => {
    state.registerForEvent.mockResolvedValue({
      ok: false,
      error: "rate_limited",
    });
    expect((await POST(post(VALID), ctx)).headers.get("retry-after")).toBe(
      "600"
    );

    state.registerForEvent.mockResolvedValue({
      ok: false,
      error: "event_full",
    });
    expect(
      (await POST(post(VALID), ctx)).headers.get("retry-after")
    ).toBeNull();
  });

  it.each([
    ["already_registered", "already-registered"],
    ["already_waitlisted", "already-waitlisted"],
    ["event_full", "event-full"],
    ["registration_closed", "registration-closed"],
    ["registration_available", "registration-available"],
  ] as const)(
    "publishes a safe conflict reason for %s",
    async (error, reason) => {
      state.registerForEvent.mockResolvedValue({ ok: false, error });
      const res = await POST(
        post(VALID, { "x-request-id": "landing-reason-123" }),
        ctx
      );
      expect(res.status).toBe(409);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        type: "https://api.essqu.com/problems/conflict",
        title: "Conflict",
        status: 409,
        code: "conflict",
        requestId: "landing-reason-123",
        reason,
      });
    }
  );

  it("exposes retry guidance to allowed browsers without adding a conflict reason", async () => {
    state.registerForEvent.mockResolvedValue({
      ok: false,
      error: "rate_limited",
    });
    const res = await POST(post(VALID), ctx);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(res.headers.get("access-control-expose-headers")).toBe(
      "X-Request-Id, Retry-After"
    );
    expect(await res.json()).not.toHaveProperty("reason");
  });

  it("answers a preflight for an allowed origin", async () => {
    const res = OPTIONS(
      new Request(
        "https://api.essqu.com/v1/events/" + EVENT_ID + "/registrations",
        {
          method: "OPTIONS",
          headers: { origin: "https://essqu.com" },
        }
      )
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("answers a preflight for an unlisted origin with no allow-origin", () => {
    const res = OPTIONS(
      new Request("https://api.essqu.com/v1/x", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("GET /v1/events", () => {
  it("requires a credential and advertises the scheme", async () => {
    state.authenticate.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const res = await GET_LIST(new Request("https://api.essqu.com/v1/events"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(state.getPublicEventPage).not.toHaveBeenCalled();
  });

  it("returns the documented envelope and a cache header", async () => {
    state.getPublicEventPage.mockResolvedValue({
      events: [],
      nextCursor: null,
    });
    const res = await GET_LIST(
      new Request("https://api.essqu.com/v1/events?period=past")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    expect(await res.json()).toEqual({ data: [], meta: { nextCursor: null } });
    expect(state.getPublicEventPage).toHaveBeenCalledWith(
      expect.objectContaining({ period: "past" })
    );
  });

  it("defaults to upcoming", async () => {
    state.getPublicEventPage.mockResolvedValue({
      events: [],
      nextCursor: null,
    });
    await GET_LIST(new Request("https://api.essqu.com/v1/events"));
    expect(state.getPublicEventPage).toHaveBeenCalledWith(
      expect.objectContaining({ period: "upcoming" })
    );
  });

  it("does not cache an unauthorised response", async () => {
    state.authenticate.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const res = await GET_LIST(new Request("https://api.essqu.com/v1/events"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 403 for a valid credential that lacks the scope", async () => {
    // The contract distinguishes "bad credential" (401) from "valid but not
    // allowed" (403). Collapsing them would send an integrator hunting a key
    // problem that does not exist.
    state.authenticate.mockResolvedValue({ ok: false, reason: "forbidden" });
    const res = await GET_LIST(new Request("https://api.essqu.com/v1/events"));
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(state.getPublicEventPage).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is unreachable", async () => {
    state.authenticate.mockResolvedValue({
      ok: false,
      reason: "service-unavailable",
    });
    expect(
      (await GET_LIST(new Request("https://api.essqu.com/v1/events"))).status
    ).toBe(503);
  });
});

describe("GET /v1/events/{id}", () => {
  it("returns 404 for a malformed id without querying", async () => {
    const res = await GET_DETAIL(
      new Request("https://api.essqu.com/v1/events/nope"),
      {
        params: Promise.resolve({ eventId: "nope" }),
      }
    );
    expect(res.status).toBe(404);
    expect(state.getPublicEvent).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing event", async () => {
    state.getPublicEvent.mockResolvedValue(null);
    expect(
      (await GET_DETAIL(new Request("https://api.essqu.com/v1/events/x"), ctx))
        .status
    ).toBe(404);
  });

  it("returns the event wrapped in data", async () => {
    state.getPublicEvent.mockResolvedValue({
      id: EVENT_ID,
      title: "T",
      description: "D",
      eventDate: new Date("2026-11-01T14:00:00.000Z"),
      location: null,
      committeeName: "C",
      availability: "open",
    });
    const res = await GET_DETAIL(
      new Request("https://api.essqu.com/v1/events/x"),
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(EVENT_ID);
    expect(body.data.availability).toBe("open");
  });

  it("gives the same 404 for draft, archived and unknown", async () => {
    // The handler cannot distinguish them because the domain returns null for
    // all three; this asserts the API never leaks which one it was.
    state.getPublicEvent.mockResolvedValue(null);
    // Both requests carry the same correlation id, so the only remaining
    // difference between the two responses would be a leak rather than the
    // freshly generated request id.
    const withId = () =>
      new Request("https://api.essqu.com/v1/events/x", {
        headers: { "x-request-id": "draft-archived-unknown" },
      });
    const a = await GET_DETAIL(withId(), ctx);
    const b = await GET_DETAIL(withId(), ctx);
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });
});
