import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  manager: vi.fn(),
  review: vi.fn(),
  activate: vi.fn(),
  detail: vi.fn(),
  setPolicy: vi.fn(),
  invite: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
  deletions: vi.fn(),
}));

vi.mock("../lib/auth/manager", () => ({ getManagerContext: state.manager }));
vi.mock("../lib/membership/server", () => ({
  reviewMembershipApplication: state.review,
  activateMembership: state.activate,
  getMembershipApplication: state.detail,
  setMembershipApprovalPolicy: state.setPolicy,
  processMembershipStorageDeletions: state.deletions,
}));
vi.mock("../lib/auth/admin", () => ({ inviteAuthUser: state.invite }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("next/server", () => ({ after: state.after }));

const {
  reviewMembershipAction,
  activateMembershipAction,
  setMembershipPolicyAction,
} = await import("../app/admin/(protected)/membership/actions");

const APPLICATION = "33333333-3333-4333-8333-333333333333";
const manager = {
  kind: "manager" as const,
  userId: "11111111-1111-4111-8111-111111111111",
  accessLevel: "BOARD_ADMIN" as const,
  committees: [],
};

function reviewForm(decision: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("applicationId", APPLICATION);
  form.set("revision", "2");
  form.set("decision", decision);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  for (const fn of Object.values(state)) fn.mockReset();
  state.manager.mockResolvedValue(manager);
  state.review.mockResolvedValue({
    code: "SUCCESS",
    status: "approved",
    revision: 3,
  });
  state.detail.mockResolvedValue({
    code: "SUCCESS",
    application: { email: "s123456@squ.edu.om" },
  });
});

describe("membership review actions", () => {
  it("passes the session actor, never a form-supplied one, and keeps notes off verification", async () => {
    state.review.mockResolvedValue({
      code: "SUCCESS",
      status: "verified",
      revision: 3,
    });
    const form = reviewForm("verify", {
      note: "ignored",
      actorId: "99999999-9999-4999-8999-999999999999",
    });
    expect(await reviewMembershipAction(null, form)).toEqual({
      code: "SUCCESS",
      decision: "verify",
      activation: undefined,
    });
    expect(state.review).toHaveBeenCalledWith({
      actorId: manager.userId,
      applicationId: APPLICATION,
      revision: 2,
      decision: "verify",
      note: null,
    });
    expect(state.activate).not.toHaveBeenCalled();
    // Verification keeps the ID card: nothing is scheduled for deletion.
    expect(state.after).not.toHaveBeenCalled();
  });

  it("schedules the ID card's Storage deletion after an approval or rejection", async () => {
    state.activate.mockResolvedValue({ code: "SUCCESS", memberId: "x" });
    for (const decision of ["approve", "reject"]) {
      state.after.mockReset();
      state.deletions.mockReset();
      await reviewMembershipAction(null, reviewForm(decision));
      expect(state.after, decision).toHaveBeenCalledTimes(1);
      expect(state.deletions).not.toHaveBeenCalled();
      await state.after.mock.calls[0][0]();
      expect(state.deletions, decision).toHaveBeenCalledTimes(1);
    }
  });

  it("after approval, invites the applicant's email from the database and activates", async () => {
    state.activate
      .mockResolvedValueOnce({ code: "NEEDS_INVITATION" })
      .mockResolvedValueOnce({
        code: "SUCCESS",
        memberId: "44444444-4444-4444-8444-444444444444",
      });
    state.invite.mockResolvedValue({
      code: "SUCCESS",
      userId: "44444444-4444-4444-8444-444444444444",
    });
    const form = reviewForm("approve", {
      note: "  Checked in person  ",
      email: "attacker@evil.example",
    });
    expect(await reviewMembershipAction(null, form)).toEqual({
      code: "SUCCESS",
      decision: "approve",
      activation: "SUCCESS",
    });
    expect(state.review.mock.calls[0][0].note).toBe("Checked in person");
    expect(state.invite).toHaveBeenCalledWith("s123456@squ.edu.om");
    expect(state.activate.mock.calls.map((call) => call[0].invitation)).toEqual(
      ["none", "sent"]
    );
  });

  it("links an existing Auth account without a second invitation", async () => {
    state.activate.mockResolvedValueOnce({ code: "SUCCESS", memberId: "x" });
    expect(
      (await reviewMembershipAction(null, reviewForm("approve")))?.activation
    ).toBe("SUCCESS");
    expect(state.invite).not.toHaveBeenCalled();
  });

  it("never invites over an applicant's own unconfirmed account", async () => {
    state.activate.mockResolvedValue({ code: "EMAIL_UNCONFIRMED" });
    expect(await reviewMembershipAction(null, reviewForm("approve"))).toEqual({
      code: "SUCCESS",
      decision: "approve",
      activation: "EMAIL_UNCONFIRMED",
    });
    expect(state.invite).not.toHaveBeenCalled();
    expect(state.activate).toHaveBeenCalledTimes(1);
  });

  it("keeps the approval when the invitation cannot be sent, so activation can be retried", async () => {
    state.activate.mockResolvedValue({ code: "NEEDS_INVITATION" });
    state.invite.mockResolvedValue({ code: "EMAIL_RATE_LIMIT" });
    expect(await reviewMembershipAction(null, reviewForm("approve"))).toEqual({
      code: "SUCCESS",
      decision: "approve",
      activation: "INVITE_RATE_LIMITED",
    });
    state.invite.mockResolvedValue({ code: "SMTP_UNAVAILABLE" });
    expect(
      (await activateMembershipAction(null, reviewForm("approve")))?.code
    ).toBe("INVITE_UNAVAILABLE");
  });

  it("returns the routine's refusal unchanged and does nothing else", async () => {
    for (const code of [
      "FORBIDDEN",
      "POLICY_NOT_CONFIRMED",
      "SELF_REVIEW",
      "STALE_REVISION",
      "SENIOR_APPROVAL_REQUIRED",
    ]) {
      state.review.mockResolvedValue({ code });
      expect(
        (await reviewMembershipAction(null, reviewForm("approve")))?.code
      ).toBe(code);
    }
    expect(state.activate).not.toHaveBeenCalled();
    expect(state.invite).not.toHaveBeenCalled();
    expect(state.after).not.toHaveBeenCalled();
  });

  it("validates input before calling the database", async () => {
    for (const form of [
      reviewForm("delete"),
      reviewForm("reject", { applicationId: "not-a-uuid" }),
      reviewForm("reject", { revision: "0" }),
      reviewForm("reject", { note: "x".repeat(501) }),
    ]) {
      expect((await reviewMembershipAction(null, form))?.code).toBe(
        "VALIDATION_ERROR"
      );
    }
    expect(state.review).not.toHaveBeenCalled();
  });

  it("requires a signed-in administrator", async () => {
    state.manager.mockResolvedValue({ kind: "anonymous" });
    expect(
      (await reviewMembershipAction(null, reviewForm("verify")))?.code
    ).toBe("AUTH_REQUIRED");
    expect(
      (await activateMembershipAction(null, reviewForm("verify")))?.code
    ).toBe("AUTH_REQUIRED");
    expect((await setMembershipPolicyAction(null, new FormData()))?.code).toBe(
      "AUTH_REQUIRED"
    );
    expect(state.review).not.toHaveBeenCalled();
  });

  it("records a policy only through the Technical-checked routine", async () => {
    state.setPolicy.mockResolvedValue({ code: "FORBIDDEN" });
    const form = new FormData();
    form.set("policy", "single_step");
    expect(await setMembershipPolicyAction(null, form)).toEqual({
      code: "FORBIDDEN",
    });
    expect(state.setPolicy).toHaveBeenCalledWith(manager.userId, "single_step");
    form.set("policy", "everyone");
    expect(await setMembershipPolicyAction(null, form)).toEqual({
      code: "VALIDATION_ERROR",
    });
  });
});
