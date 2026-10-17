import { describe, expect, it } from "vitest";
import {
  PUBLIC_ERROR_CODES,
  problem,
  type PublicErrorCode,
} from "@/lib/api/problems";
import { MAX_BODY_BYTES, readJsonBody, requestIdFrom } from "@/lib/api/http";
import { allowedOrigins, corsHeaders, isAllowedOrigin } from "@/lib/api/cors";
import { EVENTS_READ_SCOPE, hashToken, parseToken } from "@/lib/api/auth";
import { publicCodeFor, toEventDto } from "@/lib/api/dto";
import type { PublicEvent } from "@/lib/events";

/**
 * The public API is a published contract, so these tests lock the parts a
 * consumer depends on and the parts an attacker probes: error shape, CORS,
 * token parsing, body bounds and — most importantly — that no internal field or
 * internal error string can reach a response.
 */

const RID = "11111111-2222-4333-8444-555555555555";

describe("problem details", () => {
  it("covers every declared public code", () => {
    for (const code of PUBLIC_ERROR_CODES) {
      const res = problem(code, RID);
      expect(res.headers.get("content-type")).toBe(
        "application/problem+json; charset=utf-8"
      );
      expect(res.headers.get("x-request-id")).toBe(RID);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("uses the right status for each code", async () => {
    const expected: Record<PublicErrorCode, number> = {
      "bad-request": 400,
      "unsupported-media-type": 415,
      "payload-too-large": 413,
      "invalid-fields": 422,
      unauthorized: 401,
      forbidden: 403,
      "not-found": 404,
      conflict: 409,
      "rate-limited": 429,
      "service-unavailable": 503,
    };
    for (const [code, status] of Object.entries(expected)) {
      const res = problem(code as PublicErrorCode, RID);
      expect(res.status, code).toBe(status);
      const body = await res.json();
      expect(body.status).toBe(status);
      expect(body.code).toBe(code);
    }
  });

  it("advertises the bearer scheme on 401 only", () => {
    expect(problem("unauthorized", RID).headers.get("www-authenticate")).toBe(
      "Bearer"
    );
    expect(
      problem("forbidden", RID).headers.get("www-authenticate")
    ).toBeNull();
  });

  it("never leaks internals", async () => {
    const res = problem("service-unavailable", RID);
    const text = JSON.stringify(await res.json());
    // No SQL, no routine name, no stack, no credential, no PII.
    expect(text).not.toMatch(/select |insert |update |delete |from private/i);
    expect(text).not.toMatch(/register_for_event|verify_api_client/);
    expect(text).not.toMatch(/postgres|supabase|drizzle/i);
    expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(text).not.toMatch(/essq_|bearer /i);
  });

  it("carries field errors only when asked", async () => {
    const withErrors = await problem("invalid-fields", RID, {
      errors: [{ field: "attendeeEmail", code: "required" }],
    }).json();
    expect(withErrors.errors).toEqual([
      { field: "attendeeEmail", code: "required" },
    ]);
    const withoutErrors = await problem("invalid-fields", RID).json();
    expect(withoutErrors.errors).toBeUndefined();
  });
});

describe("CORS", () => {
  it("allows only exact configured origins", () => {
    expect(isAllowedOrigin("https://essqu.com")).toBe(true);
    for (const origin of [
      "https://evil.example",
      "https://essqu.com.evil.example",
      "https://sub.essqu.com",
      "http://essqu.com",
      "https://essqu-platform.vercel.app",
      "https://engsoc-platform-preview-abc.vercel.app",
      null,
    ]) {
      expect(isAllowedOrigin(origin), String(origin)).toBe(false);
    }
  });

  it("never reflects a wildcard or a credentials header", () => {
    const headers = corsHeaders("https://essqu.com");
    expect(headers["access-control-allow-origin"]).toBe("https://essqu.com");
    expect(headers["access-control-allow-credentials"]).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("*");
    // Vary keeps a shared cache from serving one origin's response to another.
    expect(headers.vary).toBe("Origin");
  });

  it("returns only Vary for a rejected origin", () => {
    const headers = corsHeaders("https://evil.example");
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers.vary).toBe("Origin");
  });

  it("defaults to the production origins when unconfigured", () => {
    expect(allowedOrigins()).toEqual([
      "https://essqu.com",
      "https://www.essqu.com",
    ]);
  });
});

describe("API client tokens", () => {
  it("parses a live token as production and a test token as staging", () => {
    const live = parseToken("essq_live_abc12345_" + "x".repeat(43));
    expect(live?.environment).toBe("production");
    expect(live?.prefix).toBe("abc12345");
    expect(live?.hash).toMatch(/^[0-9a-f]{64}$/);

    const test = parseToken("essq_test_abc12345_" + "y".repeat(43));
    expect(test?.environment).toBe("staging");
  });

  it.each([
    ["no token", ""],
    ["wrong prefix", "bearer_abc12345_" + "x".repeat(43)],
    ["short secret", "essq_live_abc12345_short"],
    ["missing prefix", "essq_live__" + "x".repeat(43)],
    ["random string", "not-a-token"],
  ])("rejects %s", (_label, token) => {
    expect(parseToken(token)).toBeNull();
  });

  it("hashes deterministically and never returns the raw token", () => {
    const token = "essq_live_abc12345_" + "z".repeat(43);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain("z");
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token + "x")).not.toBe(hashToken(token));
  });
});

describe("domain to public error mapping", () => {
  it.each([
    ["invalid_name", "invalid-fields"],
    ["invalid_email", "invalid-fields"],
    ["invalid_event", "invalid-fields"],
    ["event_not_found", "not-found"],
    ["event_not_published", "not-found"],
    ["already_registered", "conflict"],
    ["event_full", "conflict"],
    ["registration_closed", "conflict"],
    ["rate_limited", "rate-limited"],
    ["server_error", "service-unavailable"],
  ] as const)("maps %s to %s", (domainError, publicCode) => {
    expect(publicCodeFor(domainError)).toBe(publicCode);
  });
});

describe("event DTO", () => {
  const domainEvent: PublicEvent = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    title: "Title",
    description: "Description",
    eventDate: new Date("2026-11-01T14:00:00.000Z"),
    location: "SQU",
    committeeName: "Committee",
    availability: "open",
  };

  it("exposes exactly the published fields and nothing else", () => {
    const dto = toEventDto(domainEvent);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "availability",
        "committeeName",
        "description",
        "eventDate",
        "id",
        "location",
        "title",
      ].sort()
    );
    expect(dto.eventDate).toBe("2026-11-01T14:00:00.000Z");
  });

  it("cannot leak internal fields even if the domain grows them", () => {
    const widened = {
      ...domainEvent,
      status: "published",
      capacity: 50,
      committeeId: "should-not-appear",
      revision: 3,
      registrationCount: 12,
    } as unknown as PublicEvent;
    const serialized = JSON.stringify(toEventDto(widened));
    for (const leak of [
      "status",
      "capacity",
      "committeeId",
      "revision",
      "registrationCount",
      "should-not-appear",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});

describe("request body handling", () => {
  function jsonRequest(body: string, contentType = "application/json") {
    return new Request("https://api.example/v1/events/x/registrations", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
  }

  it("parses a normal JSON body", async () => {
    const result = await readJsonBody(jsonRequest('{"a":1}'));
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuses a non-JSON content type", async () => {
    // The classic CORS bypass is posting JSON as text/plain to skip a preflight.
    expect(await readJsonBody(jsonRequest('{"a":1}', "text/plain"))).toEqual({
      ok: false,
      reason: "unsupported-media-type",
    });
  });

  it("refuses malformed JSON", async () => {
    expect(await readJsonBody(jsonRequest("{not json"))).toEqual({
      ok: false,
      reason: "bad-request",
    });
  });

  it("enforces the size limit while streaming, not only by Content-Length", async () => {
    const oversized = JSON.stringify({ a: "x".repeat(MAX_BODY_BYTES + 1) });
    expect(await readJsonBody(jsonRequest(oversized))).toEqual({
      ok: false,
      reason: "payload-too-large",
    });
  });

  it("rejects an oversized declared length before reading", async () => {
    const request = new Request("https://api.example/v1/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_BODY_BYTES + 1),
      },
      body: "{}",
    });
    expect(await readJsonBody(request)).toEqual({
      ok: false,
      reason: "payload-too-large",
    });
  });
});

describe("request ids", () => {
  it("keeps a safe caller value", () => {
    const request = new Request("https://api.example/v1/events", {
      headers: { "x-request-id": "landing-abc-123" },
    });
    expect(requestIdFrom(request)).toBe("landing-abc-123");
  });

  it("replaces an unsafe caller value", () => {
    // Header values cannot carry control characters, so the unsafe set here is
    // about shape and length rather than injection: too short, too long, and
    // characters outside the permitted set.
    for (const unsafe of [
      "short",
      "x".repeat(200),
      "bad value with spaces",
      "semi;colon,comma",
    ]) {
      const request = new Request("https://api.example/v1/events", {
        headers: { "x-request-id": unsafe },
      });
      const id = requestIdFrom(request);
      expect(id).not.toBe(unsafe);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("generates one when absent", () => {
    expect(requestIdFrom(new Request("https://api.example/v1/events"))).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });
});

describe("scopes", () => {
  it("uses the documented read scope", () => {
    expect(EVENTS_READ_SCOPE).toBe("events:read");
  });
});
