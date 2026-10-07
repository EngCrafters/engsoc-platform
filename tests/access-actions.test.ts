import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  context: vi.fn(),
  change: vi.fn(),
  replace: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("../lib/auth/manager", () => ({ getManagerContext: state.context }));
vi.mock("../lib/access/server", () => ({
  changeAccess: state.change,
  replaceManager: state.replace,
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));

import {
  changeAccessAction,
  replaceManagerAction,
} from "../app/admin/(protected)/access/actions";

const actor = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const committee = "33333333-3333-4333-8333-333333333333";
const initial = { success: false, message: "" };

function form(operation: string, level: string, committeeId = committee) {
  const data = new FormData();
  data.set("operation", operation);
  data.set("userId", target);
  data.set("level", level);
  data.set("committeeId", committeeId);
  data.set("note", "approved change");
  return data;
}

describe("Technical access action", () => {
  beforeEach(() => {
    state.context.mockReset().mockResolvedValue({
      kind: "manager",
      userId: actor,
      accessLevel: "TECHNICAL",
    });
    state.change.mockReset().mockResolvedValue({ code: "SUCCESS" });
    state.replace.mockReset().mockResolvedValue({ code: "SUCCESS" });
    state.revalidate.mockReset();
  });

  it("denies revoked/no-access sessions and forged actor fields for replacement", async () => {
    state.context.mockResolvedValue({ kind: "unassigned", userId: actor });
    const data = form("grant", "COMMITTEE_MANAGER");
    data.set("oldUserId", target);
    data.set("newUserId", actor);
    data.set("actorId", target);
    expect((await replaceManagerAction(initial, data)).success).toBe(false);
    expect((await changeAccessAction(initial, data)).success).toBe(false);
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.change).not.toHaveBeenCalled();
  });

  it("validates replacement, uses the authenticated actor, and reports safe domain errors", async () => {
    const next = "44444444-4444-4444-8444-444444444444";
    const data = form("replace", "COMMITTEE_MANAGER");
    data.set("oldUserId", target);
    data.set("newUserId", next);
    data.set("actorId", target);
    expect((await replaceManagerAction(initial, data)).success).toBe(true);
    expect(state.replace).toHaveBeenCalledWith({
      actorId: actor,
      oldUserId: target,
      newUserId: next,
      committeeId: committee,
      note: "approved change",
    });
    state.replace.mockResolvedValue({ code: "SECOND_MANAGER_SCOPE" });
    expect((await replaceManagerAction(initial, data)).message).toContain(
      "Reassign their committee instead"
    );
    state.replace.mockRejectedValue(new Error("private SQL details"));
    expect((await replaceManagerAction(initial, data)).message).toBe(
      "The replacement result could not be confirmed. Refresh the user list before trying again."
    );
    state.replace.mockClear();
    data.append("newUserId", actor);
    expect((await replaceManagerAction(initial, data)).success).toBe(false);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("rejects duplicate access fields and translates already-revoked access", async () => {
    const data = form("revoke", "COMMITTEE_MANAGER");
    state.change.mockResolvedValue({ code: "ACCESS_ALREADY_REVOKED" });
    expect((await changeAccessAction(initial, data)).message).toBe(
      "This account no longer has administrative access."
    );
    state.change.mockClear();
    data.append("operation", "grant");
    expect((await changeAccessAction(initial, data)).success).toBe(false);
    expect(state.change).not.toHaveBeenCalled();
  });

  it("rejects Board and Committee Manager calls before the runtime routine", async () => {
    for (const accessLevel of ["BOARD_ADMIN", "COMMITTEE_MANAGER"]) {
      state.context.mockResolvedValueOnce({
        kind: "manager",
        userId: actor,
        accessLevel,
      });
      const result = await changeAccessAction(
        initial,
        form("grant", "BOARD_ADMIN", "")
      );
      expect(result.message).toBe(
        "This action is available only to the Technical Team."
      );
    }
    expect(state.change).not.toHaveBeenCalled();
  });

  it("sends Technical ownership changes through the authorized server routine", async () => {
    const result = await changeAccessAction(
      initial,
      form("grant", "TECHNICAL", "")
    );
    expect(result.success).toBe(true);
    expect(state.change).toHaveBeenCalledWith({
      actorId: actor,
      userId: target,
      level: "TECHNICAL",
      committeeId: null,
      operation: "grant",
      note: "approved change",
    });
  });

  it("shows a clear last-owner safeguard error", async () => {
    state.change.mockResolvedValueOnce({ code: "LAST_TECHNICAL_ADMIN" });
    const result = await changeAccessAction(
      initial,
      form("revoke", "TECHNICAL", "")
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain(
      "At least one active Technical Team administrator"
    );
  });

  it("passes an explicit one-committee reassignment and refreshes the list", async () => {
    const result = await changeAccessAction(
      initial,
      form("reassign", "COMMITTEE_MANAGER")
    );
    expect(result.success).toBe(true);
    expect(state.change).toHaveBeenCalledWith({
      actorId: actor,
      userId: target,
      level: "COMMITTEE_MANAGER",
      committeeId: committee,
      operation: "reassign",
      note: "approved change",
    });
    expect(state.revalidate).toHaveBeenCalledWith("/admin/access");
  });
});
