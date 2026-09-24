import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  redirect: vi.fn(),
  authRedirectUrl: vi.fn(),
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
    state.authRedirectUrl
      .mockReset()
      .mockReturnValue("https://app.example/auth/callback?next=/auth/reset");
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
      {
        redirectTo: "https://app.example/auth/callback?next=/auth/reset",
      }
    );
  });

  it("explains a recovery service failure without exposing account existence", async () => {
    state.resetPasswordForEmail.mockResolvedValue({ error: { status: 503 } });
    const form = new FormData();
    form.set("email", "manager@example.test");
    const result = await requestRecoveryAction(
      initialRecoveryActionState,
      form
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/could not be sent/i);
      expect(result.message).not.toMatch(/manager@example.test/i);
    }
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

  it("updates a password only with one valid recovery-session submission", async () => {
    const form = new FormData();
    form.set("password", "a sufficiently long new password");
    await expect(
      resetPasswordAction(initialResetActionState, form)
    ).rejects.toThrow("redirect");
    expect(state.updateUser).toHaveBeenCalledWith({
      password: "a sufficiently long new password",
    });
    expect(state.redirect).toHaveBeenCalledWith("/admin/events");
  });
});
