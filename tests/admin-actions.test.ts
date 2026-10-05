import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  redirect: vi.fn(),
  authRedirectUrl: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("../lib/auth/server", () => ({
  createAuthServerClient: async () => ({
    auth: {
      signInWithPassword: state.signInWithPassword,
      resetPasswordForEmail: state.resetPasswordForEmail,
      signOut: state.signOut,
      updateUser: state.updateUser,
    },
  }),
  authRedirectUrl: state.authRedirectUrl,
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: state.cookieSet }),
}));

import {
  loginAction,
  logoutAction,
  requestRecoveryAction,
} from "../app/admin/actions";
import {
  initialLoginActionState,
  initialRecoveryActionState,
} from "../app/admin/action-state";
import { initialResetActionState } from "../app/auth/reset/action-state";
import { resetPasswordAction } from "../app/auth/reset/actions";

function loginForm() {
  const form = new FormData();
  form.set("email", "manager@example.test");
  form.set("password", "a valid test password");
  form.set("next", "/admin/events");
  return form;
}

describe("admin authentication actions", () => {
  beforeEach(() => {
    state.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    state.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    state.signOut.mockReset().mockResolvedValue({ error: null });
    state.updateUser.mockReset().mockResolvedValue({ error: null });
    state.redirect.mockReset().mockImplementation(() => {
      throw new Error("redirect");
    });
    state.cookieSet.mockReset();
    state.authRedirectUrl
      .mockReset()
      .mockReturnValue("https://app.example/auth/callback");
  });

  it("uses a singular credential form and only an allowlisted return path", async () => {
    await expect(
      loginAction(initialLoginActionState, loginForm())
    ).rejects.toThrow("redirect");
    expect(state.signInWithPassword).toHaveBeenCalledWith({
      email: "manager@example.test",
      password: "a valid test password",
    });
    expect(state.redirect).toHaveBeenCalledWith("/admin/events");
  });

  it("rejects duplicate credential fields before contacting Auth", async () => {
    const form = loginForm();
    form.append("email", "other@example.test");
    await expect(loginAction(initialLoginActionState, form)).resolves.toEqual({
      status: "error",
      message: "Enter your email address and password.",
    });
    expect(state.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not expose the provider's login error", async () => {
    state.signInWithPassword.mockResolvedValue({
      error: new Error("user missing"),
    });
    await expect(
      loginAction(initialLoginActionState, loginForm())
    ).resolves.toEqual({
      status: "error",
      message: "We couldn't sign you in with those details.",
    });
  });

  it("explains temporary sign-in outages without leaking the provider error", async () => {
    state.signInWithPassword.mockRejectedValue(new Error("internal SQL error"));
    const result = await loginAction(initialLoginActionState, loginForm());
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/temporarily unavailable/i);
      expect(result.message).not.toMatch(/sql/i);
    }
  });

  it("sends recovery through the fixed callback URL with generic success", async () => {
    const form = new FormData();
    form.set("email", "manager@example.test");
    await expect(
      requestRecoveryAction(initialRecoveryActionState, form)
    ).resolves.toEqual({ status: "sent" });
    expect(state.resetPasswordForEmail).toHaveBeenCalledWith(
      "manager@example.test",
      { redirectTo: "https://app.example/auth/callback" }
    );
    // The callback learns this browser asked for a recovery from an httpOnly marker.
    expect(state.cookieSet).toHaveBeenCalledWith(
      "es-recovery-intent",
      "1",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });

  it("reports an Auth email rate limit as a delivery limit, not an account fact", async () => {
    state.resetPasswordForEmail.mockResolvedValue({
      error: { status: 429, code: "over_email_send_rate_limit" },
    });
    const form = new FormData();
    form.set("email", "manager@example.test");
    const result = await requestRecoveryAction(
      initialRecoveryActionState,
      form
    );
    expect(result).toEqual({
      status: "error",
      message:
        "Email delivery is temporarily limited. Use the Technical password-reset option or try again later.",
    });
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it("explains an SMTP failure without exposing account existence", async () => {
    state.resetPasswordForEmail.mockResolvedValue({ error: { status: 503 } });
    const form = new FormData();
    form.set("email", "manager@example.test");
    const result = await requestRecoveryAction(
      initialRecoveryActionState,
      form
    );
    expect(result).toEqual({
      status: "error",
      message: "Authentication email delivery is temporarily unavailable.",
    });
  });

  it("treats an unknown address exactly like a known one", async () => {
    state.resetPasswordForEmail.mockResolvedValue({
      error: { status: 400, code: "user_not_found" },
    });
    const form = new FormData();
    form.set("email", "nobody@example.test");
    await expect(
      requestRecoveryAction(initialRecoveryActionState, form)
    ).resolves.toEqual({ status: "sent" });
  });

  it("does not call Auth when a fixed recovery redirect is not configured", async () => {
    state.authRedirectUrl.mockReturnValue(null);
    const form = new FormData();
    form.set("email", "manager@example.test");
    await expect(
      requestRecoveryAction(initialRecoveryActionState, form)
    ).resolves.toEqual({
      status: "error",
      message:
        "Password recovery is temporarily unavailable. Contact the platform maintenance authority.",
    });
    expect(state.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("clears the Supabase session before redirecting on logout", async () => {
    await expect(logoutAction()).rejects.toThrow("redirect");
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(state.redirect).toHaveBeenCalledWith("/admin/login");
  });

  function resetForm(password = "a sufficiently long new password") {
    const form = new FormData();
    form.set("password", password);
    form.set("confirmPassword", password);
    return form;
  }

  it("updates the password, ends the recovery session and sends the user to sign in", async () => {
    await expect(
      resetPasswordAction(initialResetActionState, resetForm())
    ).rejects.toThrow("redirect");
    expect(state.updateUser).toHaveBeenCalledWith({
      password: "a sufficiently long new password",
    });
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(state.redirect).toHaveBeenCalledWith("/admin/login?reset=success");
  });

  it("rejects short passwords and mismatched confirmation before contacting Auth", async () => {
    const short = await resetPasswordAction(
      initialResetActionState,
      resetForm("too short")
    );
    expect(short).toMatchObject({ status: "error" });
    const mismatch = resetForm();
    mismatch.set("confirmPassword", "something else entirely");
    await expect(
      resetPasswordAction(initialResetActionState, mismatch)
    ).resolves.toEqual({
      status: "error",
      message: "The two passwords do not match.",
    });
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("reports an expired recovery session and keeps the account signed out", async () => {
    state.updateUser.mockResolvedValue({
      error: { status: 401, code: "session_not_found", name: "AuthApiError" },
    });
    await expect(
      resetPasswordAction(initialResetActionState, resetForm())
    ).resolves.toEqual({
      status: "expired",
      message: "This password-reset link has expired. Request a new one.",
    });
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it("explains reuse of the current password and generic update failures safely", async () => {
    state.updateUser.mockResolvedValueOnce({
      error: { status: 422, code: "same_password" },
    });
    await expect(
      resetPasswordAction(initialResetActionState, resetForm())
    ).resolves.toEqual({
      status: "error",
      message: "Choose a password different from your current one.",
    });
    state.updateUser.mockResolvedValueOnce({
      error: { status: 500, message: "SQL: relation auth.users" },
    });
    const result = await resetPasswordAction(
      initialResetActionState,
      resetForm()
    );
    expect(result).toEqual({
      status: "error",
      message: "The password could not be updated. Try again.",
    });
  });

  it("never echoes the submitted password back", async () => {
    state.updateUser.mockResolvedValue({ error: { status: 500 } });
    const result = await resetPasswordAction(
      initialResetActionState,
      resetForm("a sufficiently long new password")
    );
    expect(JSON.stringify(result)).not.toContain("sufficiently");
  });
});
