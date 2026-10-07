import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  manager: vi.fn(),
  writeAdminEvent: vi.fn(),
  writeLifecycleEvent: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("../lib/auth/manager", () => ({ getManagerContext: state.manager }));
vi.mock("../lib/admin-events/server", () => ({
  writeAdminEvent: state.writeAdminEvent,
  writeLifecycleEvent: state.writeLifecycleEvent,
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));

import {
  lifecycleEventAction,
  saveEventAction,
} from "../app/admin/(protected)/events/actions";

const manager = {
  kind: "manager" as const,
  userId: "11111111-1111-4111-8111-111111111111",
  accessLevel: "COMMITTEE_MANAGER" as const,
  committees: [{ id: "22222222-2222-4222-8222-222222222222", name: "Events" }],
};

function createForm() {
  const form = new FormData();
  form.set("committeeId", manager.committees[0].id);
  form.set("title", "Engineering workshop");
  form.set("description", "A practical session.");
  form.set("eventDate", "2027-02-14T09:30");
  form.set("location", "Innovation Lab");
  form.set("capacity", "24");
  return form;
}

describe("admin event actions", () => {
  beforeEach(() => {
    state.manager.mockReset().mockResolvedValue(manager);
    state.writeAdminEvent.mockReset().mockResolvedValue({
      code: "SUCCESS",
      eventId: "33333333-3333-4333-8333-333333333333",
    });
    state.writeLifecycleEvent
      .mockReset()
      .mockResolvedValue({ code: "SUCCESS", revision: 2 });
    state.redirect.mockReset().mockImplementation(() => {
      throw new Error("redirect");
    });
    state.revalidatePath.mockReset();
  });

  it("denies a still-authenticated identity after its access is revoked", async () => {
    state.manager.mockResolvedValue({
      kind: "unassigned",
      userId: manager.userId,
      email: "retained@example.test",
    });
    const result = await saveEventAction(createForm());
    expect(result.code).not.toBe("SUCCESS");
    expect(state.writeAdminEvent).not.toHaveBeenCalled();
    expect(state.writeLifecycleEvent).not.toHaveBeenCalled();
  });

  it("creates through the fixed routine with an explicit Muscat offset", async () => {
    await expect(saveEventAction(createForm())).rejects.toThrow("redirect");
    expect(state.writeAdminEvent).toHaveBeenCalledWith("create_event", [
      manager.userId,
      manager.committees[0].id,
      "Engineering workshop",
      "A practical session.",
      "2027-02-14T09:30:00+04:00",
      "Innovation Lab",
      24,
    ]);
  });

  it("rejects duplicate event form keys before a routine is called", async () => {
    const form = createForm();
    form.append("title", "Forged title");
    await expect(saveEventAction(form)).resolves.toEqual({
      code: "VALIDATION_ERROR",
    });
    expect(state.writeAdminEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed event and committee IDs before a routine is called", async () => {
    const malformedCreate = createForm();
    malformedCreate.set("committeeId", "not-a-uuid");
    await expect(saveEventAction(malformedCreate)).resolves.toEqual({
      code: "VALIDATION_ERROR",
    });

    const malformedEdit = createForm();
    malformedEdit.delete("committeeId");
    malformedEdit.set("eventId", "not-a-uuid");
    malformedEdit.set("revision", "1");
    await expect(saveEventAction(malformedEdit)).resolves.toEqual({
      code: "VALIDATION_ERROR",
    });

    const malformedLifecycle = new FormData();
    malformedLifecycle.set("operation", "publish_event");
    malformedLifecycle.set("eventId", "not-a-uuid");
    malformedLifecycle.set("revision", "1");
    await expect(
      lifecycleEventAction(null, malformedLifecycle)
    ).resolves.toEqual({ code: "VALIDATION_ERROR" });
    expect(state.writeAdminEvent).not.toHaveBeenCalled();
    expect(state.writeLifecycleEvent).not.toHaveBeenCalled();
  });

  it("returns a safe server result when the runtime routine throws", async () => {
    state.writeLifecycleEvent.mockRejectedValueOnce(
      new Error("database error")
    );
    const form = new FormData();
    form.set("operation", "publish_event");
    form.set("eventId", "33333333-3333-4333-8333-333333333333");
    form.set("revision", "1");
    await expect(lifecycleEventAction(null, form)).resolves.toEqual({
      code: "SERVER_ERROR",
    });
  });

  it("uses the authenticated actor for lifecycle commands and refreshes both views", async () => {
    const form = new FormData();
    form.set("operation", "publish_event");
    form.set("eventId", "33333333-3333-4333-8333-333333333333");
    form.set("revision", "1");
    await expect(lifecycleEventAction(null, form)).resolves.toEqual({
      code: "SUCCESS",
      revision: 2,
    });
    expect(state.writeLifecycleEvent).toHaveBeenCalledWith(
      "publish_event",
      manager.userId,
      "33333333-3333-4333-8333-333333333333",
      1
    );
    expect(state.revalidatePath).toHaveBeenCalledWith(
      "/admin/events/33333333-3333-4333-8333-333333333333"
    );
    expect(state.revalidatePath).toHaveBeenCalledWith("/admin/events");
  });

  it("rejects a forged lifecycle operation without reaching the runtime database", async () => {
    const form = new FormData();
    form.set("operation", "drop_everything");
    form.set("eventId", "33333333-3333-4333-8333-333333333333");
    form.set("revision", "1");
    await expect(lifecycleEventAction(null, form)).resolves.toEqual({
      code: "VALIDATION_ERROR",
    });
    expect(state.writeLifecycleEvent).not.toHaveBeenCalled();
  });

  it("requires Board or Technical access for review decisions", async () => {
    const form = new FormData();
    form.set("operation", "approve_event");
    form.set("eventId", "33333333-3333-4333-8333-333333333333");
    form.set("revision", "2");
    await expect(lifecycleEventAction(null, form)).resolves.toEqual({
      code: "GLOBAL_ACCESS_REQUIRED",
    });
    expect(state.writeLifecycleEvent).not.toHaveBeenCalled();
    state.manager.mockResolvedValueOnce({
      ...manager,
      accessLevel: "BOARD_ADMIN",
    });
    await expect(lifecycleEventAction(null, form)).resolves.toMatchObject({
      code: "SUCCESS",
    });
    expect(state.writeLifecycleEvent).toHaveBeenCalledWith(
      "approve_event",
      manager.userId,
      "33333333-3333-4333-8333-333333333333",
      2
    );
  });
});
