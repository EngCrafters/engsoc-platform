import { beforeEach, describe, expect, it, vi } from "vitest";

// Dashboard actions of ADR 0025. The actor always comes from the verified session; the form
// carries only identifiers and text, and the routines (mocked here) decide authority.
const state = vi.hoisted(() => ({
  manager: vi.fn(),
  decideSqu: vi.fn(),
  revokeSqu: vi.fn(),
  decideLeadership: vi.fn(),
  revokeAppointment: vi.fn(),
  settings: vi.fn(),
  positionLimit: vi.fn(),
  requestsOpen: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  moveTeam: vi.fn(),
  status: vi.fn(),
  deleteTeam: vi.fn(),
  assign: vi.fn(),
  updateAppointment: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}));
vi.mock("../lib/auth/manager", async () => {
  const { withAccess } = await import("./support/manager-fixture");
  return {
    getManagerContext: async (...args: unknown[]) =>
      withAccess(
        await (state.manager as (...a: unknown[]) => unknown)(...args)
      ),
  };
});
vi.mock("../lib/verification/review", () => ({
  decideSquVerification: state.decideSqu,
  revokeSquVerification: state.revokeSqu,
  decideLeadershipRequest: state.decideLeadership,
  revokeAppointment: state.revokeAppointment,
  setVerificationSettings: state.settings,
  setPositionLimit: state.positionLimit,
  setLeadershipRequestsOpen: state.requestsOpen,
}));
vi.mock("../lib/administration/teams", () => ({
  createTeam: state.createTeam,
  updateTeam: state.updateTeam,
  moveTeam: state.moveTeam,
  setTeamStatus: state.status,
  deleteTeam: state.deleteTeam,
  assignLeadership: state.assign,
  updateAppointment: state.updateAppointment,
}));
vi.mock("../lib/membership/server", () => ({
  processMembershipStorageDeletions: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("next/server", () => ({ after: state.after }));

const actions =
  await import("../app/admin/(protected)/membership/verification-actions");
const teams =
  await import("../app/admin/(protected)/administration/committees/[id]/team-actions");

const ACTOR = "11111111-1111-4111-8111-111111111111";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const COMMITTEE = "44444444-4444-4444-8444-444444444444";
const TEAM = "55555555-5555-4555-8555-555555555555";
const manager = (accessLevel = "BOARD_ADMIN") => ({
  kind: "manager" as const,
  userId: ACTOR,
  accessLevel,
  committees: [],
});
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  for (const fn of Object.values(state)) fn.mockReset();
  state.manager.mockResolvedValue(manager());
  for (const fn of [
    state.decideSqu,
    state.revokeSqu,
    state.decideLeadership,
    state.revokeAppointment,
    state.settings,
    state.positionLimit,
    state.createTeam,
    state.updateTeam,
    state.moveTeam,
    state.status,
    state.deleteTeam,
    state.assign,
    state.updateAppointment,
  ])
    fn.mockResolvedValue({ code: "SUCCESS" });
});

describe("SQU and leadership decisions", () => {
  it("decides as the session's user, passing the reason only for a rejection", async () => {
    await actions.decideSquAction(
      null,
      form({
        requestId: REQUEST,
        revision: "1",
        decision: "approve",
        reason: "ignored",
        note: " Looks right ",
      })
    );
    expect(state.decideSqu).toHaveBeenLastCalledWith(
      ACTOR,
      REQUEST,
      1,
      "approve",
      null,
      "Looks right"
    );
    await actions.decideSquAction(
      null,
      form({
        requestId: REQUEST,
        revision: "2",
        decision: "reject",
        reason: "Blurred photo",
      })
    );
    expect(state.decideSqu).toHaveBeenLastCalledWith(
      ACTOR,
      REQUEST,
      2,
      "reject",
      "Blurred photo",
      null
    );
    expect(state.revalidatePath).toHaveBeenCalledWith(
      `/admin/membership/verifications/${REQUEST}`
    );
  });

  it("refuses a signed-out caller and malformed forms before any routine runs", async () => {
    state.manager.mockResolvedValue({ kind: "anonymous" });
    expect(
      await actions.decideSquAction(
        null,
        form({ requestId: REQUEST, revision: "1", decision: "approve" })
      )
    ).toEqual({ code: "FORBIDDEN" });
    state.manager.mockResolvedValue(manager());
    const malformed: Record<string, string>[] = [
      { requestId: "x", revision: "1", decision: "approve" },
      { requestId: REQUEST, revision: "0", decision: "approve" },
      { requestId: REQUEST, revision: "1", decision: "promote" },
      {
        requestId: REQUEST,
        revision: "1",
        decision: "reject",
        reason: "x".repeat(501),
      },
    ];
    for (const fields of malformed)
      expect(
        (await actions.decideLeadershipAction(null, form(fields)))?.code
      ).toBe("VALIDATION_ERROR");
    expect(state.decideLeadership).not.toHaveBeenCalled();
    expect(state.decideSqu).not.toHaveBeenCalled();
  });

  it("revalidates nothing when the routine refuses", async () => {
    state.decideLeadership.mockResolvedValue({ code: "SELF_REVIEW" });
    expect(
      await actions.decideLeadershipAction(
        null,
        form({ requestId: REQUEST, revision: "1", decision: "approve" })
      )
    ).toEqual({ code: "SELF_REVIEW" });
    expect(state.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires a reason to revoke, and revalidates only known dashboard paths", async () => {
    expect(
      await actions.revokeAppointmentAction(
        null,
        form({ appointmentId: TEAM, revision: "1", reason: " " })
      )
    ).toEqual({ code: "VALIDATION_ERROR", field: "reason" });
    await actions.revokeAppointmentAction(
      null,
      form({
        appointmentId: TEAM,
        revision: "1",
        reason: "Term ended",
        returnPath: "https://evil.example/x",
      })
    );
    expect(state.revalidatePath.mock.calls.flat()).toEqual([
      "/admin/membership/leadership",
    ]);
    state.revalidatePath.mockReset();
    await actions.revokeAppointmentAction(
      null,
      form({
        appointmentId: TEAM,
        revision: "1",
        reason: "Term ended",
        returnPath: `/admin/administration/committees/${COMMITTEE}`,
      })
    );
    expect(state.revalidatePath).toHaveBeenCalledWith(
      `/admin/administration/committees/${COMMITTEE}`
    );
    expect(state.revokeAppointment).toHaveBeenLastCalledWith(
      ACTOR,
      TEAM,
      1,
      "Term ended",
      null
    );
  });

  it("records settings with empty values meaning not set, and checks ranges first", async () => {
    expect(
      (
        await actions.saveVerificationSettingsAction(
          null,
          form({
            squSubmissionsPer30Days: "3",
            documentRetentionDays: "5",
            leadershipRequestsPer30Days: "5",
            maxActiveAppointmentsPerMember: "",
          })
        )
      )?.field
    ).toBe("documentRetentionDays");
    expect(state.settings).not.toHaveBeenCalled();
    await actions.saveVerificationSettingsAction(
      null,
      form({
        squSubmissionsPer30Days: "3",
        documentRetentionDays: "",
        leadershipRequestsPer30Days: "5",
        maxActiveAppointmentsPerMember: "",
      })
    );
    // The third argument is the explicit retention confirmation (ADR 0027), absent here.
    expect(state.settings).toHaveBeenCalledWith(
      ACTOR,
      {
        squSubmissionsPer30Days: 3,
        documentRetentionDays: null,
        leadershipRequestsPer30Days: 5,
        maxActiveAppointmentsPerMember: null,
      },
      false
    );
  });
});

describe("team actions", () => {
  it("are for Board Administration and Technical only", async () => {
    state.manager.mockResolvedValue(manager("COMMITTEE_MANAGER"));
    const result = await teams.saveTeamAction(
      { status: "idle" },
      form({ committeeId: COMMITTEE, nameEn: "Development" })
    );
    expect(result.status).toBe("error");
    expect(state.createTeam).not.toHaveBeenCalled();
  });

  it("creates or updates a team with trimmed bilingual text", async () => {
    await teams.saveTeamAction(
      { status: "idle" },
      form({
        committeeId: COMMITTEE,
        nameEn: " Development ",
        nameAr: " فريق التطوير ",
        descriptionEn: "",
      })
    );
    expect(state.createTeam).toHaveBeenCalledWith(ACTOR, COMMITTEE, {
      nameEn: "Development",
      nameAr: "فريق التطوير",
      descriptionEn: null,
      descriptionAr: null,
    });
    await teams.saveTeamAction(
      { status: "idle" },
      form({ committeeId: COMMITTEE, teamId: TEAM, nameEn: "Dev" })
    );
    expect(state.updateTeam).toHaveBeenCalledWith(
      ACTOR,
      TEAM,
      expect.objectContaining({ nameEn: "Dev" })
    );
  });

  it("explains blocked archiving and revalidates both committees after a move", async () => {
    state.status.mockResolvedValue({ code: "BLOCKED", appointments: 2 });
    expect(
      await teams.teamStatusAction(
        { status: "idle" },
        form({ committeeId: COMMITTEE, teamId: TEAM, status: "archived" })
      )
    ).toEqual({
      status: "error",
      message: "2 active appointments must be revoked first.",
    });
    const target = "66666666-6666-4666-8666-666666666666";
    state.moveTeam.mockResolvedValue({ code: "SUCCESS", cancelledRequests: 1 });
    const moved = await teams.moveTeamAction(
      { status: "idle" },
      form({ committeeId: COMMITTEE, teamId: TEAM, targetCommitteeId: target })
    );
    expect(moved.status).toBe("success");
    expect(state.revalidatePath).toHaveBeenCalledWith(
      `/admin/administration/committees/${COMMITTEE}`
    );
    expect(state.revalidatePath).toHaveBeenCalledWith(
      `/admin/administration/committees/${target}`
    );
  });

  it("leaves appointments to Board Administration: Technical manages teams only", async () => {
    state.manager.mockResolvedValue(manager("TECHNICAL"));
    const refused = await teams.assignLeaderAction(
      { status: "idle" },
      form({
        committeeId: COMMITTEE,
        teamId: TEAM,
        memberId: REQUEST,
        position: "chief",
      })
    );
    expect(refused.status).toBe("error");
    const changed = await teams.changeLeaderPositionAction(
      { status: "idle" },
      form({
        committeeId: COMMITTEE,
        appointmentId: REQUEST,
        position: "assistant_chief",
        revision: "1",
      })
    );
    expect(changed.status).toBe("error");
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("appoints directly with a known position only", async () => {
    expect(
      (
        await teams.assignLeaderAction(
          { status: "idle" },
          form({
            committeeId: COMMITTEE,
            teamId: TEAM,
            memberId: REQUEST,
            position: "Chief!",
          })
        )
      ).status
    ).toBe("error");
    expect(state.assign).not.toHaveBeenCalled();
    await teams.assignLeaderAction(
      { status: "idle" },
      form({
        committeeId: COMMITTEE,
        teamId: TEAM,
        memberId: REQUEST,
        position: "chief",
      })
    );
    expect(state.assign).toHaveBeenCalledWith(
      ACTOR,
      REQUEST,
      COMMITTEE,
      TEAM,
      "chief",
      null
    );
  });

  it("appoints a committee leader with no team (ADR 0026)", async () => {
    await teams.assignLeaderAction(
      { status: "idle" },
      form({
        committeeId: COMMITTEE,
        memberId: REQUEST,
        position: "assistant_chief",
      })
    );
    expect(state.assign).toHaveBeenCalledWith(
      ACTOR,
      REQUEST,
      COMMITTEE,
      null,
      "assistant_chief",
      null
    );
    state.assign.mockClear();
    expect(
      (
        await teams.assignLeaderAction(
          { status: "idle" },
          form({
            committeeId: COMMITTEE,
            teamId: "not-a-team",
            memberId: REQUEST,
            position: "chief",
          })
        )
      ).status
    ).toBe("error");
    expect(state.assign).not.toHaveBeenCalled();
  });
});

describe("the leadership requests switch (ADR 0026)", () => {
  it("passes only an explicit open or closed state, for the session user", async () => {
    state.requestsOpen.mockResolvedValue({ code: "SUCCESS" });
    expect(
      await actions.setLeadershipRequestsOpenAction(
        null,
        form({ open: "maybe" })
      )
    ).toEqual({ code: "VALIDATION_ERROR", field: "open" });
    expect(state.requestsOpen).not.toHaveBeenCalled();
    expect(
      await actions.setLeadershipRequestsOpenAction(
        null,
        form({ open: "false" })
      )
    ).toMatchObject({ code: "SUCCESS" });
    expect(state.requestsOpen).toHaveBeenCalledWith(ACTOR, false);
    expect(state.revalidatePath).toHaveBeenCalledWith(
      "/admin/membership/leadership"
    );
  });

  it("returns the routine's refusal unchanged, so a Society Affairs manager sees it", async () => {
    state.requestsOpen.mockResolvedValue({ code: "FORBIDDEN" });
    expect(
      await actions.setLeadershipRequestsOpenAction(
        null,
        form({ open: "true" })
      )
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(state.revalidatePath).not.toHaveBeenCalled();
  });
});
