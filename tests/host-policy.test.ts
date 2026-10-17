import { describe, expect, it } from "vitest";
import {
  ADMIN_HOST,
  API_HOST,
  checkHostRoute,
  classifyHost,
  hostEnforcementEnabled,
  isPathAllowedOnHost,
} from "@/lib/api/host-policy";

/**
 * Host isolation for the Core project.
 *
 * The policy is dormant in production right now, so these tests are what make it
 * safe to switch on: the cutover becomes a configuration change, and the rules
 * are already proven.
 */

const ON = { CORE_API_HOST_ENFORCEMENT: "true" };
const OFF = {};

describe("hostEnforcementEnabled", () => {
  it("is off by default, so an unattached hostname cannot break production", () => {
    expect(hostEnforcementEnabled(OFF)).toBe(false);
    expect(hostEnforcementEnabled({ CORE_API_HOST_ENFORCEMENT: "1" })).toBe(
      false
    );
    expect(hostEnforcementEnabled({ CORE_API_HOST_ENFORCEMENT: "TRUE" })).toBe(
      false
    );
  });

  it("is on only for the exact opt-in value", () => {
    expect(hostEnforcementEnabled(ON)).toBe(true);
  });
});

describe("classifyHost", () => {
  it.each([
    [API_HOST, "api"],
    ["api.essqu.com:443", "api"],
    ["API.ESSQU.COM", "api"],
    [ADMIN_HOST, "admin"],
    ["admin.essqu.com:3000", "admin"],
    ["localhost:3000", "local"],
    ["127.0.0.1:3100", "local"],
    ["engsoc-platform-abc-eng-crafters.vercel.app", "preview"],
    ["engsoc-platform.vercel.app", "preview"],
    ["essqu.com", "unknown-host"],
    ["evil.example", "unknown-host"],
    [null, "unknown-host"],
  ])("classifies %s as %s", (host, expected) => {
    expect(classifyHost(host)).toBe(expected);
  });
});

describe("isPathAllowedOnHost", () => {
  it("serves only /v1 on the api host", () => {
    for (const path of ["/v1", "/v1/events", "/v1/events/x/registrations"]) {
      expect(isPathAllowedOnHost("api", path), path).toBe(true);
    }
    for (const path of ["/admin/login", "/auth/reset", "/", "/admin"]) {
      expect(isPathAllowedOnHost("api", path), path).toBe(false);
    }
  });

  it("serves admin and Auth on the admin host, and not /v1", () => {
    for (const path of [
      "/admin/login",
      "/admin/events",
      "/auth/reset",
      "/",
      "/auth/callback",
    ]) {
      expect(isPathAllowedOnHost("admin", path), path).toBe(true);
    }
    for (const path of ["/v1", "/v1/events"]) {
      expect(isPathAllowedOnHost("admin", path), path).toBe(false);
    }
  });

  it("does not trap local, preview or unknown hosts", () => {
    for (const cls of ["local", "preview", "unknown-host"] as const) {
      for (const path of ["/v1/events", "/admin/login", "/auth/reset", "/"]) {
        expect(isPathAllowedOnHost(cls, path), cls + path).toBe(true);
      }
    }
  });
});

describe("checkHostRoute", () => {
  it("allows everything while dormant", () => {
    // Today's production behaviour: the domains are not attached.
    for (const host of [API_HOST, ADMIN_HOST, "essqu.com", null]) {
      for (const path of ["/v1/events", "/admin/login"]) {
        expect(checkHostRoute(host, path, OFF), String(host) + path).toEqual({
          ok: true,
        });
      }
    }
  });

  it("refuses admin paths on the api host once enforced", () => {
    expect(checkHostRoute(API_HOST, "/admin/login", ON)).toEqual({
      ok: false,
      reason: "host-mismatch",
    });
    expect(checkHostRoute(API_HOST, "/v1/events", ON)).toEqual({ ok: true });
  });

  it("refuses /v1 on the admin host once enforced", () => {
    expect(checkHostRoute(ADMIN_HOST, "/v1/events", ON)).toEqual({
      ok: false,
      reason: "host-mismatch",
    });
    expect(checkHostRoute(ADMIN_HOST, "/admin/login", ON)).toEqual({
      ok: true,
    });
  });

  it("keeps preview and unknown hosts working when enforced", () => {
    expect(checkHostRoute("x-y.vercel.app", "/v1/events", ON)).toEqual({
      ok: true,
    });
    expect(checkHostRoute("essqu.com", "/v1/events", ON)).toEqual({ ok: true });
  });
});
