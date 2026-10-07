import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getManagerContext: vi.fn(),
  changeAccess: vi.fn(),
  listAuthDirectory: vi.fn(),
  listUserAudit: vi.fn(),
  recordAuthAdminAction: vi.fn(),
  inviteAuthUser: vi.fn(),
  createAuthUserWithPassword: vi.fn(),
  createAuthUserWithoutPassword: vi.fn(),
  resendAuthInvitation: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  setTemporaryPassword: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/auth/manager", () => ({
  getManagerContext: mocks.getManagerContext,
}));
vi.mock("../lib/access/server", () => ({
  changeAccess: mocks.changeAccess,
  listAuthDirectory: mocks.listAuthDirectory,
  listUserAudit: mocks.listUserAudit,
  recordAuthAdminAction: mocks.recordAuthAdminAction,
}));
vi.mock("../lib/auth/admin", () => ({
  createAuthUserWithPassword: mocks.createAuthUserWithPassword,
  createAuthUserWithoutPassword: mocks.createAuthUserWithoutPassword,
  inviteAuthUser: mocks.inviteAuthUser,
  resendAuthInvitation: mocks.resendAuthInvitation,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  setTemporaryPassword: mocks.setTemporaryPassword,
  isPlausibleEmail: (value: string) => /^\S+@\S+\.\S+$/.test(value),
}));

import {
  createUserAction,
  getUserHistoryAction,
  resendInvitationAction,
  sendResetEmailAction,
  setTemporaryPasswordAction,
} from "../app/admin/(protected)/access/user-actions";
import { initialUserActionState } from "../app/admin/(protected)/access/user-state";

const TECH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FINANCE = "33333333-3333-4333-8333-333333333333";
const committees = [{ id: FINANCE, name: "Finance Committee" }];

function actor(level: string) {
  return {
    kind: "manager",
    userId: TECH,
    email: "tech@example.test",
    accessLevel: level,
    committees,
  };
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const entry = {
  user_id: OTHER,
  email: "person@example.test",
  email_confirmed: true,
  created_at: "2026-10-01T00:00:00Z",
  last_sign_in_at: null,
  invited: false,
};

describe("Technical user administration actions", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getManagerContext.mockResolvedValue(actor("TECHNICAL"));
    mocks.changeAccess.mockResolvedValue({ code: "SUCCESS" });
    mocks.listAuthDirectory.mockResolvedValue([entry]);
    mocks.recordAuthAdminAction.mockResolvedValue({ code: "SUCCESS" });
    mocks.inviteAuthUser.mockResolvedValue({ code: "SUCCESS", userId: OTHER });
    mocks.createAuthUserWithPassword.mockResolvedValue({
      code: "SUCCESS",
      userId: OTHER,
    });
    mocks.createAuthUserWithoutPassword.mockResolvedValue({
      code: "SUCCESS",
      userId: OTHER,
    });
    mocks.sendPasswordResetEmail.mockResolvedValue({ code: "SUCCESS" });
    mocks.resendAuthInvitation.mockResolvedValue({ code: "SUCCESS" });
    mocks.setTemporaryPassword.mockResolvedValue({ code: "SUCCESS" });
  });

  const deniedMessage = "This action is available only to the Technical Team.";

  it.each(["BOARD_ADMIN", "COMMITTEE_MANAGER"])(
    "denies every operation to a %s and touches nothing",
    async (level) => {
      mocks.getManagerContext.mockResolvedValue(actor(level));
      const create = form({
        email: "new@example.test",
        level: "BOARD_ADMIN",
        committeeId: "",
        method: "invite",
      });
      const results = await Promise.all([
        createUserAction(initialUserActionState, create),
        sendResetEmailAction(initialUserActionState, form({ userId: OTHER })),
        resendInvitationAction(initialUserActionState, form({ userId: OTHER })),
        setTemporaryPasswordAction(
          initialUserActionState,
          form({
            userId: OTHER,
            password: "x".repeat(14),
            confirmPassword: "x".repeat(14),
          })
        ),
      ]);
      for (const result of results) {
        expect(result).toEqual({ status: "error", message: deniedMessage });
      }
      await expect(getUserHistoryAction(OTHER)).resolves.toEqual([]);
      expect(mocks.inviteAuthUser).not.toHaveBeenCalled();
      expect(mocks.setTemporaryPassword).not.toHaveBeenCalled();
      expect(mocks.changeAccess).not.toHaveBeenCalled();
      expect(mocks.listUserAudit).not.toHaveBeenCalled();
    }
  );

  it("denies an anonymous caller", async () => {
    mocks.getManagerContext.mockResolvedValue({ kind: "anonymous" });
    const result = await sendResetEmailAction(
      initialUserActionState,
      form({ userId: OTHER })
    );
    expect(result).toMatchObject({ status: "error", message: deniedMessage });
  });

  it("creates an invited manager: identity first, audit label, then the audited grant", async () => {
    const result = await createUserAction(
      initialUserActionState,
      form({
        email: " New@Example.Test ",
        level: "COMMITTEE_MANAGER",
        committeeId: FINANCE,
        method: "invite",
      })
    );
    expect(result).toEqual({
      status: "success",
      message: "Invitation sent and access assigned.",
    });
    expect(mocks.inviteAuthUser).toHaveBeenCalledWith("new@example.test");
    expect(mocks.recordAuthAdminAction).toHaveBeenCalledWith({
      actorId: TECH,
      targetId: OTHER,
      action: "user.invited",
      detail: "invitation",
    });
    expect(mocks.changeAccess).toHaveBeenCalledWith({
      actorId: TECH,
      userId: OTHER,
      level: "COMMITTEE_MANAGER",
      committeeId: FINANCE,
      operation: "grant",
      note: null,
    });
  });

  it("requires exactly one valid committee for a manager and none for other roles", async () => {
    for (const bad of [
      { level: "COMMITTEE_MANAGER", committeeId: "" },
      { level: "COMMITTEE_MANAGER", committeeId: OTHER },
      { level: "BOARD_ADMIN", committeeId: FINANCE },
    ]) {
      const result = await createUserAction(
        initialUserActionState,
        form({ email: "n@example.test", method: "invite", ...bad })
      );
      expect(result).toEqual({
        status: "error",
        message: "Check the details and try again.",
      });
    }
    expect(mocks.inviteAuthUser).not.toHaveBeenCalled();
  });

  it("handles a duplicate email safely and creates no access", async () => {
    mocks.inviteAuthUser.mockResolvedValue({ code: "EMAIL_EXISTS" });
    const result = await createUserAction(
      initialUserActionState,
      form({
        email: "dup@example.test",
        level: "BOARD_ADMIN",
        committeeId: "",
        method: "invite",
      })
    );
    expect(result).toEqual({
      status: "error",
      message: "An account already exists with this email address.",
    });
    expect(mocks.changeAccess).not.toHaveBeenCalled();
  });

  it("says the account exists but has no access when the grant fails", async () => {
    mocks.changeAccess.mockResolvedValue({ code: "REASSIGN_REQUIRED" });
    const result = await createUserAction(
      initialUserActionState,
      form({
        email: "n@example.test",
        level: "BOARD_ADMIN",
        committeeId: "",
        method: "no_email",
      })
    );
    expect(result.status).toBe("error");
    expect(result).toMatchObject({
      message: expect.stringContaining("The account was created, but access"),
    });
  });

  it.each(["create", "reset", "invite", "password"])(
    "reports completed %s operations when their audit write fails, without repeating them",
    async (operation) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const secret = "sensitive error and password sentinel";
      const actions = {
        create: () =>
          createUserAction(
            initialUserActionState,
            form({
              email: "new@example.test",
              level: "BOARD_ADMIN",
              committeeId: "",
              method: "no_email",
            })
          ),
        reset: () =>
          sendResetEmailAction(initialUserActionState, form({ userId: OTHER })),
        invite: () =>
          resendInvitationAction(
            initialUserActionState,
            form({ userId: OTHER })
          ),
        password: () =>
          setTemporaryPasswordAction(
            initialUserActionState,
            form({
              userId: OTHER,
              password: secret,
              confirmPassword: secret,
            })
          ),
      };
      const messages = {
        create: "Account created and access assigned.",
        reset: "Password-reset email requested.",
        invite: "Invitation sent again.",
        password: "The password was changed.",
      };
      mocks.listAuthDirectory.mockResolvedValue([
        { ...entry, invited: true, email_confirmed: false },
      ]);
      try {
        for (const failure of ["rejected", "exception"]) {
          mocks.recordAuthAdminAction.mockReset();
          if (failure === "rejected")
            mocks.recordAuthAdminAction.mockResolvedValue({ code: secret });
          else mocks.recordAuthAdminAction.mockRejectedValue(new Error(secret));
          const result = await actions[operation as keyof typeof actions]();
          expect(result).toMatchObject({
            status: "error",
            message: expect.stringContaining(
              messages[operation as keyof typeof messages]
            ),
          });
          expect(result).toMatchObject({
            message: expect.stringContaining("Do not repeat the operation"),
          });
          expect(mocks.recordAuthAdminAction).toHaveBeenCalledTimes(1);
          expect(JSON.stringify(result)).not.toContain(secret);
          expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
        }
        const mutation =
          operation === "create"
            ? mocks.createAuthUserWithoutPassword
            : operation === "reset"
              ? mocks.sendPasswordResetEmail
              : operation === "invite"
                ? mocks.resendAuthInvitation
                : mocks.setTemporaryPassword;
        expect(mutation).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith(
          "auth_admin_audit_failed",
          expect.objectContaining({ actorId: TECH, targetId: OTHER })
        );
      } finally {
        log.mockRestore();
      }
    }
  );

  it("reports uncertain access after account creation without leaking or retrying a DB failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.changeAccess.mockRejectedValue(new Error("private SQL failure"));
    try {
      const result = await createUserAction(
        initialUserActionState,
        form({
          email: "new@example.test",
          level: "BOARD_ADMIN",
          committeeId: "",
          method: "no_email",
        })
      );
      expect(result).toMatchObject({
        status: "error",
        message: expect.stringContaining(
          "access status could not be confirmed"
        ),
      });
      expect(JSON.stringify(result)).not.toContain("private SQL");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
      expect(mocks.createAuthUserWithoutPassword).toHaveBeenCalledTimes(1);
      expect(mocks.changeAccess).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("validates a temporary password at creation and never audits or returns it", async () => {
    const weak = await createUserAction(
      initialUserActionState,
      form({
        email: "n@example.test",
        level: "TECHNICAL",
        committeeId: "",
        method: "password",
        password: "short",
        confirmPassword: "short",
      })
    );
    expect(weak).toMatchObject({ status: "error" });
    expect(mocks.createAuthUserWithPassword).not.toHaveBeenCalled();

    const password = "a temporary pass phrase";
    const ok = await createUserAction(
      initialUserActionState,
      form({
        email: "n@example.test",
        level: "TECHNICAL",
        committeeId: "",
        method: "password",
        password,
        confirmPassword: password,
      })
    );
    expect(ok.status).toBe("success");
    expect(JSON.stringify(ok)).not.toContain("phrase");
    expect(
      JSON.stringify(mocks.recordAuthAdminAction.mock.calls)
    ).not.toContain("phrase");
    expect(JSON.stringify(mocks.changeAccess.mock.calls)).not.toContain(
      "phrase"
    );
  });

  it("sends a reset to the account's own address and audits only a label", async () => {
    const result = await sendResetEmailAction(
      initialUserActionState,
      form({ userId: OTHER })
    );
    expect(result.status).toBe("success");
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      "person@example.test"
    );
    expect(mocks.recordAuthAdminAction).toHaveBeenCalledWith({
      actorId: TECH,
      targetId: OTHER,
      action: "user.password_reset_sent",
      detail: undefined,
    });
  });

  it("reports mail rate limits with the technical fallback guidance", async () => {
    mocks.sendPasswordResetEmail.mockResolvedValue({
      code: "EMAIL_RATE_LIMIT",
    });
    const result = await sendResetEmailAction(
      initialUserActionState,
      form({ userId: OTHER })
    );
    expect(result).toEqual({
      status: "error",
      message:
        "Email delivery is temporarily limited. Use the Technical password-reset option or try again later.",
    });
    expect(mocks.recordAuthAdminAction).not.toHaveBeenCalled();
  });

  it("reports a missing account", async () => {
    mocks.listAuthDirectory.mockResolvedValue([]);
    const result = await sendResetEmailAction(
      initialUserActionState,
      form({ userId: OTHER })
    );
    expect(result).toEqual({
      status: "error",
      message: "The selected account no longer exists.",
    });
  });

  it("will not resend an invitation that was accepted", async () => {
    const result = await resendInvitationAction(
      initialUserActionState,
      form({ userId: OTHER })
    );
    expect(result).toEqual({
      status: "error",
      message: "This account has already accepted its invitation.",
    });
    expect(mocks.resendAuthInvitation).not.toHaveBeenCalled();
  });

  it("sets a temporary password write-only: validated, applied, audited without content", async () => {
    const password = "another temporary phrase";
    const result = await setTemporaryPasswordAction(
      initialUserActionState,
      form({ userId: OTHER, password, confirmPassword: password })
    );
    expect(result).toEqual({
      status: "success",
      message: "The password was changed.",
    });
    expect(mocks.setTemporaryPassword).toHaveBeenCalledWith(OTHER, password);
    expect(mocks.recordAuthAdminAction).toHaveBeenCalledWith({
      actorId: TECH,
      targetId: OTHER,
      action: "user.password_admin_reset",
      detail: undefined,
    });
    expect(JSON.stringify(result)).not.toContain("phrase");
    expect(
      JSON.stringify(mocks.recordAuthAdminAction.mock.calls)
    ).not.toContain("phrase");
  });

  it("enforces the password policy and refuses to target the caller", async () => {
    const mismatch = await setTemporaryPasswordAction(
      initialUserActionState,
      form({
        userId: OTHER,
        password: "x".repeat(14),
        confirmPassword: "y".repeat(14),
      })
    );
    expect(mismatch).toMatchObject({ status: "error" });
    const self = await setTemporaryPasswordAction(
      initialUserActionState,
      form({
        userId: TECH,
        password: "x".repeat(14),
        confirmPassword: "x".repeat(14),
      })
    );
    expect(self).toEqual({
      status: "error",
      message: "Use your own account page to change your own password.",
    });
    expect(mocks.setTemporaryPassword).not.toHaveBeenCalled();
  });

  it("rejects duplicate password fields and preserves intentional whitespace", async () => {
    const duplicate = form({
      userId: OTHER,
      password: "a long temporary password",
      confirmPassword: "a long temporary password",
    });
    duplicate.append("password", "attacker value");
    const rejected = await setTemporaryPasswordAction(
      initialUserActionState,
      duplicate
    );
    expect(rejected.status).toBe("error");
    expect(mocks.setTemporaryPassword).not.toHaveBeenCalled();

    const password = "  a long temporary password  ";
    const accepted = await setTemporaryPasswordAction(
      initialUserActionState,
      form({ userId: OTHER, password, confirmPassword: password })
    );
    expect(accepted.status).toBe("success");
    expect(mocks.setTemporaryPassword).toHaveBeenCalledWith(OTHER, password);
  });

  it("maps a failed password update to a safe message", async () => {
    mocks.setTemporaryPassword.mockResolvedValue({
      code: "PASSWORD_UPDATE_FAILED",
    });
    const result = await setTemporaryPasswordAction(
      initialUserActionState,
      form({
        userId: OTHER,
        password: "x".repeat(14),
        confirmPassword: "x".repeat(14),
      })
    );
    expect(result).toEqual({
      status: "error",
      message: "The password could not be updated. Try again.",
    });
    expect(mocks.recordAuthAdminAction).not.toHaveBeenCalled();
  });

  it("returns readable history labels with no raw state or secrets", async () => {
    mocks.listUserAudit.mockResolvedValue([
      {
        id: "a1",
        occurred_at: "2026-10-05T08:00:00Z",
        actor_user_id: TECH,
        action: "user.password_admin_reset",
        committee_id: null,
        previous_state: null,
        new_state: null,
        note: null,
      },
    ]);
    mocks.listAuthDirectory.mockResolvedValue([
      { ...entry, user_id: TECH, email: "tech@example.test" },
    ]);
    const history = await getUserHistoryAction(OTHER);
    expect(history).toEqual([
      {
        id: "a1",
        when: "2026-10-05T08:00:00.000Z",
        actor: "tech@example.test",
        label: "Password changed by an administrator",
        detail: "",
      },
    ]);
  });
});
