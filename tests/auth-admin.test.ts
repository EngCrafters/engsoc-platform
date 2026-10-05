import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    mocks.createClient(...args);
    return {
      auth: {
        admin: {
          inviteUserByEmail: mocks.inviteUserByEmail,
          createUser: mocks.createUser,
          updateUserById: mocks.updateUserById,
        },
        resetPasswordForEmail: mocks.resetPasswordForEmail,
      },
    };
  },
}));
vi.mock("../lib/auth/server", () => ({
  authRedirectUrl: () => "https://app.example/auth/callback",
}));

import {
  createAuthUserWithPassword,
  createAuthUserWithoutPassword,
  inviteAuthUser,
  mapAuthAdminError,
  resendAuthInvitation,
  sendPasswordResetEmail,
  setTemporaryPassword,
} from "../lib/auth/admin";

describe("Auth administration (server only)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mocks.createUser.mockResolvedValue({
      data: { user: { id: "u2" } },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("does nothing without the server-side key, so no client is ever built", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(inviteAuthUser("a@example.test")).resolves.toEqual({
      code: "UNAVAILABLE",
    });
    await expect(setTemporaryPassword("u", "x".repeat(12))).resolves.toEqual({
      code: "UNAVAILABLE",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses a stateless service client: no stored session, no URL detection", async () => {
    await inviteAuthUser("a@example.test");
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://project.example",
      "service-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  });

  it("invites by email through the fixed production callback", async () => {
    await expect(inviteAuthUser("a@example.test")).resolves.toEqual({
      code: "SUCCESS",
      userId: "u1",
    });
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith("a@example.test", {
      redirectTo: "https://app.example/auth/callback",
    });
  });

  it("reports a duplicate email without creating a second account", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: {},
      error: { status: 422, code: "email_exists" },
    });
    await expect(inviteAuthUser("a@example.test")).resolves.toEqual({
      code: "EMAIL_EXISTS",
    });
    mocks.createUser.mockResolvedValue({
      data: {},
      error: {
        status: 422,
        message: "A user with this email address has already been registered",
      },
    });
    await expect(
      createAuthUserWithPassword("a@example.test", "x".repeat(12))
    ).resolves.toEqual({ code: "EMAIL_EXISTS" });
  });

  it("rejects malformed emails before contacting Auth", async () => {
    await expect(inviteAuthUser("not an email")).resolves.toEqual({
      code: "INVALID_INPUT",
    });
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("creates a confirmed account without a password and without sending email", async () => {
    await createAuthUserWithoutPassword("a@example.test");
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "a@example.test",
      email_confirm: true,
    });
  });

  it("creating with a password returns only an id, never the password", async () => {
    const result = await createAuthUserWithPassword(
      "a@example.test",
      "correct horse battery staple"
    );
    expect(JSON.stringify(result)).not.toContain("horse");
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "correct horse battery staple",
      email_confirm: true,
    });
  });

  it("sets a temporary password through the Admin API and says only that it worked", async () => {
    const password = "a temporary pass phrase";
    const result = await setTemporaryPassword("user-id", password);
    expect(result).toEqual({ code: "SUCCESS" });
    expect(JSON.stringify(result)).not.toContain("phrase");
    expect(mocks.updateUserById).toHaveBeenCalledWith("user-id", {
      password,
      email_confirm: true,
    });
  });

  it("maps password failures to safe codes without leaking provider text", async () => {
    mocks.updateUserById.mockResolvedValue({
      data: {},
      error: { status: 500, message: "SQL error near auth.users" },
    });
    const result = await setTemporaryPassword("user-id", "x".repeat(12));
    expect(result).toEqual({ code: "PASSWORD_UPDATE_FAILED" });
    mocks.updateUserById.mockResolvedValue({
      data: {},
      error: { status: 422, code: "weak_password" },
    });
    await expect(
      setTemporaryPassword("user-id", "x".repeat(12))
    ).resolves.toEqual({ code: "WEAK_PASSWORD" });
    mocks.updateUserById.mockRejectedValue(new Error("boom"));
    await expect(
      setTemporaryPassword("user-id", "x".repeat(12))
    ).resolves.toEqual({ code: "PASSWORD_UPDATE_FAILED" });
  });

  it("sends technical reset emails with a stateless implicit-flow client", async () => {
    await expect(sendPasswordResetEmail("a@example.test")).resolves.toEqual({
      code: "SUCCESS",
    });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://project.example",
      "anon-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          flowType: "implicit",
        }),
      })
    );
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("a@example.test", {
      redirectTo: "https://app.example/auth/callback",
    });
  });

  it("reports mail rate limits and SMTP outages distinctly", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { status: 429, code: "over_email_send_rate_limit" },
    });
    await expect(sendPasswordResetEmail("a@example.test")).resolves.toEqual({
      code: "EMAIL_RATE_LIMIT",
    });
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { status: 500, message: "Error sending recovery email" },
    });
    await expect(sendPasswordResetEmail("a@example.test")).resolves.toEqual({
      code: "SMTP_UNAVAILABLE",
    });
  });

  it("does not resend an invitation that was already accepted", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: {},
      error: { status: 422, code: "email_exists" },
    });
    await expect(resendAuthInvitation("a@example.test")).resolves.toEqual({
      code: "INVALID_INPUT",
    });
  });

  it("maps provider errors", () => {
    expect(mapAuthAdminError(null)).toBe("SUCCESS");
    expect(mapAuthAdminError({ code: "user_not_found" })).toBe(
      "USER_NOT_FOUND"
    );
    expect(mapAuthAdminError({ status: 503 })).toBe("SMTP_UNAVAILABLE");
    expect(mapAuthAdminError({ status: 418 })).toBe("UNAVAILABLE");
  });
});
