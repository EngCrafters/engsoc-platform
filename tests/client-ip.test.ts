import { describe, expect, it } from "vitest";
import {
  IGNORED_IP_HEADERS,
  LOCAL_DEVELOPMENT_IP,
  VERCEL_CLIENT_IP_HEADER,
  normalizeIp,
  resolveClientIp,
} from "@/lib/client-ip/server";

/**
 * F-05: the client IP is a security input, because it keys the database
 * registration limiter. These tests prove the resolver reads exactly one
 * header, refuses spoofable ones, and fails closed on anything unrecognised.
 */

function headers(pairs: Record<string, string>) {
  return new Headers(pairs);
}

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7:4432", "203.0.113.7"],
    ["2001:db8::1", "2001:db8::1"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["  198.51.100.9  ", "198.51.100.9"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["not-an-ip", "garbage"],
    ["203.0.113.7, 10.0.0.1", "a forwarded list"],
    ["[2001:db8::1", "unterminated bracket"],
    ["[2001:db8::1]x", "junk after bracket"],
    ["1.2.3.4:notaport", "bad port"],
    ["999.999.999.999", "out-of-range IPv4"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizeIp(input)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe("resolveClientIp", () => {
  it("accepts the Vercel edge header in production", () => {
    expect(
      resolveClientIp(headers({ [VERCEL_CLIENT_IP_HEADER]: "203.0.113.7" }), {
        environment: "production",
      })
    ).toEqual({ ok: true, ip: "203.0.113.7", source: "vercel-edge" });
  });

  it.each(IGNORED_IP_HEADERS)(
    "refuses to trust %s as the client address",
    (header) => {
      const result = resolveClientIp(headers({ [header]: "203.0.113.7" }), {
        environment: "production",
      });
      expect(result).toEqual({ ok: false, reason: "missing" });
    }
  );

  it("does not fall back to a spoofable header when the edge header is absent", () => {
    // The classic bypass: send x-forwarded-for and hope something reads it.
    const result = resolveClientIp(
      headers({
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "1.2.3.4",
      }),
      { environment: "production" }
    );
    expect(result.ok).toBe(false);
  });

  it("does not let a spoofed edge header win over a malformed one", () => {
    const result = resolveClientIp(
      headers({
        [VERCEL_CLIENT_IP_HEADER]: "not-an-ip",
        "x-forwarded-for": "203.0.113.7",
      }),
      { environment: "production" }
    );
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("fails closed in production when the edge header is missing", () => {
    expect(resolveClientIp(headers({}), { environment: "production" })).toEqual(
      {
        ok: false,
        reason: "missing",
      }
    );
  });

  it("uses the documented loopback in development", () => {
    expect(
      resolveClientIp(headers({}), { environment: "development" })
    ).toEqual({
      ok: true,
      ip: LOCAL_DEVELOPMENT_IP,
      source: "local-development",
    });
  });

  it("prefers a real edge header over the development default", () => {
    expect(
      resolveClientIp(headers({ [VERCEL_CLIENT_IP_HEADER]: "203.0.113.7" }), {
        environment: "development",
      })
    ).toEqual({ ok: true, ip: "203.0.113.7", source: "vercel-edge" });
  });
});
