import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callbackFailureDestination,
  classifyAuthEmailError,
  classifyLinkFailure,
  parseOtpType,
  readAuthHash,
  resolveCallbackDestination,
  rootEmailLinkRedirect,
  validateNewPassword,
} from "../lib/auth/callback";
import { authRedirectUrl } from "../lib/auth/server";

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({}) }));

describe("recovery redirect configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends every Auth email to the fixed production /auth/callback", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "https://engsoc-platform.vercel.app");
    expect(authRedirectUrl()).toBe(
      "https://engsoc-platform.vercel.app/auth/callback"
    );
  });

  it("never produces a localhost or non-https redirect in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const origin of [
      "http://localhost:3000",
      "https://localhost:3000",
      "https://127.0.0.1",
      "http://engsoc-platform.vercel.app",
    ]) {
      vi.stubEnv("AUTH_REDIRECT_ORIGIN", origin);
      expect(authRedirectUrl()).toBeNull();
    }
  });

  it("allows a localhost origin only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "http://localhost:3000");
    expect(authRedirectUrl()).toBe("http://localhost:3000/auth/callback");
  });

  it("is unavailable rather than guessing when the origin is missing or invalid", () => {
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "");
    expect(authRedirectUrl()).toBeNull();
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "not a url");
    expect(authRedirectUrl()).toBeNull();
  });
});

describe("callback destination", () => {
  it("accepts only the supported email link types", () => {
    expect(parseOtpType("recovery")).toBe("recovery");
    expect(parseOtpType("invite")).toBe("invite");
    expect(parseOtpType("sms")).toBeNull();
    expect(parseOtpType(null)).toBeNull();
  });

  it("sends recovery and invitation links to the password page", () => {
    for (const type of ["recovery", "invite"] as const) {
      expect(
        resolveCallbackDestination({ next: null, type, recoveryIntent: false })
      ).toBe("/auth/reset");
    }
  });

  it("treats a PKCE code as a recovery only when this browser asked for one", () => {
    expect(
      resolveCallbackDestination({
        next: null,
        type: null,
        recoveryIntent: true,
      })
    ).toBe("/auth/reset");
    expect(
      resolveCallbackDestination({
        next: null,
        type: null,
        recoveryIntent: false,
      })
    ).toBe("/admin/events");
  });

  it("keeps older links with next=/auth/reset working and blocks open redirects", () => {
    expect(
      resolveCallbackDestination({
        next: "/auth/reset",
        type: null,
        recoveryIntent: false,
      })
    ).toBe("/auth/reset");
    for (const next of ["https://evil.example", "//evil.example", "/events"]) {
      expect(
        resolveCallbackDestination({ next, type: null, recoveryIntent: false })
      ).toBe("/admin/events");
    }
  });

  it("separates expired from invalid links and picks the matching page", () => {
    expect(classifyLinkFailure({ code: "otp_expired" })).toBe("expired");
    expect(classifyLinkFailure({ message: "Token has expired" })).toBe(
      "expired"
    );
    expect(classifyLinkFailure({ code: "validation_failed" })).toBe("invalid");
    expect(callbackFailureDestination("/auth/reset", "expired")).toBe(
      "/admin/recovery?link=expired"
    );
    expect(callbackFailureDestination("/admin/events", "invalid")).toBe(
      "/admin/login?auth=failed"
    );
  });
});

describe("URL fragment relay", () => {
  it("recognises a recovery session delivered in the fragment", () => {
    expect(
      readAuthHash("#access_token=a.b.c&refresh_token=r&type=recovery")
    ).toEqual({ kind: "session", accessToken: "a.b.c", refreshToken: "r" });
    expect(
      readAuthHash("#access_token=a&refresh_token=r&type=invite")
    ).toMatchObject({ kind: "session" });
  });

  it("ignores unrelated fragments and non-recovery sessions", () => {
    expect(readAuthHash("")).toEqual({ kind: "ignore" });
    expect(readAuthHash("#section-2")).toEqual({ kind: "ignore" });
    expect(
      readAuthHash("#access_token=a&refresh_token=r&type=magiclink")
    ).toEqual({ kind: "ignore" });
    expect(readAuthHash("#access_token=a&type=recovery")).toEqual({
      kind: "ignore",
    });
  });

  it("maps fragment errors to expired or invalid", () => {
    expect(readAuthHash("#error=access_denied&error_code=otp_expired")).toEqual(
      { kind: "error", failure: "expired" }
    );
    expect(
      readAuthHash("#error=access_denied&error_description=Link+is+invalid")
    ).toEqual({ kind: "error", failure: "invalid" });
  });
});

describe("auth email problems and password policy", () => {
  it("separates rate limits and SMTP failures from everything else", () => {
    expect(
      classifyAuthEmailError({
        status: 429,
        code: "over_email_send_rate_limit",
      })
    ).toBe("EMAIL_RATE_LIMIT");
    expect(
      classifyAuthEmailError({
        status: 500,
        message: "Error sending recovery email",
      })
    ).toBe("SMTP_UNAVAILABLE");
    expect(
      classifyAuthEmailError({ status: 400, code: "user_not_found" })
    ).toBe(null);
    expect(classifyAuthEmailError(null)).toBeNull();
  });

  it("enforces the minimum length and matching confirmation", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least 12/);
    expect(validateNewPassword("x".repeat(12), "y".repeat(12))).toMatch(
      /do not match/
    );
    expect(validateNewPassword("x".repeat(2000), "x".repeat(2000))).toMatch(
      /too long/
    );
    expect(validateNewPassword("x".repeat(12), "x".repeat(12))).toBeNull();
  });
});

describe("email links that land on the root", () => {
  it("forwards only a well-formed token-hash link of a known type to the callback", () => {
    expect(
      rootEmailLinkRedirect({
        token_hash: "pkce_abcdef0123456789",
        type: "recovery",
      })
    ).toBe("/auth/callback?token_hash=pkce_abcdef0123456789&type=recovery");
    expect(rootEmailLinkRedirect({})).toBeNull();
    expect(
      rootEmailLinkRedirect({ token_hash: "abcdef0123456789" })
    ).toBeNull();
    expect(
      rootEmailLinkRedirect({ token_hash: "abcdef0123456789", type: "admin" })
    ).toBeNull();
    expect(
      rootEmailLinkRedirect({
        token_hash: "x/../../evil?next=",
        type: "recovery",
      })
    ).toBeNull();
    expect(
      rootEmailLinkRedirect({ token_hash: ["a", "b"], type: "recovery" })
    ).toBeNull();
  });
});
