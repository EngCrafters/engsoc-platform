import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  context: vi.fn(),
  change: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("../lib/auth/manager", () => ({ getManagerContext: state.context }));
vi.mock("../lib/access/server", () => ({ changeAccess: state.change }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));

import { changeAccessAction } from "../app/admin/(protected)/access/actions";

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
    state.revalidate.mockReset();
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

  it("never accepts Technical grants from the browser form", async () => {
    const result = await changeAccessAction(
      initial,
      form("grant", "TECHNICAL", "")
    );
    expect(result.success).toBe(false);
    expect(state.change).not.toHaveBeenCalled();
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
