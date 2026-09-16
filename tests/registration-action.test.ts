import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  register: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => state.requestHeaders }));
vi.mock("@/lib/registrations", () => ({ registerForEvent: state.register }));

import { registerForEventAction } from "../app/(marketing)/actions";
import { initialRegisterActionState } from "../app/(marketing)/action-state";

const eventId = "11111111-1111-4111-8111-111111111111";

function form() {
  const data = new FormData();
  data.set("eventId", eventId);
  data.set("attendeeName", "Test Attendee");
  data.set("attendeeEmail", "test@example.test");
  data.set("intent", "register");
  return data;
}

describe("registration Server Action boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    state.requestHeaders = new Headers({
      "x-vercel-forwarded-for": "203.0.113.10",
    });
    state.register.mockReset();
    state.register.mockResolvedValue({ ok: true });
  });

  it("accepts a valid singular anonymous submission and maps success", async () => {
    await expect(
      registerForEventAction(initialRegisterActionState, form())
    ).resolves.toEqual({ status: "success", waitlisted: false });
    expect(state.register).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, ipAddress: "203.0.113.10" })
    );
  });

  it.each(["eventId", "attendeeName", "attendeeEmail", "intent"])(
    "rejects duplicate %s",
    async (name) => {
      const data = form();
      data.append(name, "duplicate");
      await expect(
        registerForEventAction(initialRegisterActionState, data)
      ).resolves.toEqual({ status: "error", error: "invalid_input" });
      expect(state.register).not.toHaveBeenCalled();
    }
  );

  it("rejects unrelated fields without calling the domain layer", async () => {
    const data = form();
    data.set("memberId", "spoofed");
    await expect(
      registerForEventAction(initialRegisterActionState, data)
    ).resolves.toEqual({ status: "error", error: "invalid_input" });
  });

  it("ignores spoofable forwarding headers and fails safely when the trusted IP is absent or malformed", async () => {
    for (const headers of [
      new Headers({ "x-forwarded-for": "203.0.113.10" }),
      new Headers({ forwarded: "for=203.0.113.10" }),
      new Headers({ "x-real-ip": "203.0.113.10" }),
      new Headers({ "x-vercel-forwarded-for": "not-an-ip" }),
    ]) {
      state.requestHeaders = headers;
      state.register.mockResolvedValue({ ok: false, error: "invalid_ip" });
      await expect(
        registerForEventAction(initialRegisterActionState, form())
      ).resolves.toEqual({ status: "error", error: "invalid_ip" });
      expect(state.register).toHaveBeenLastCalledWith(
        expect.objectContaining({ ipAddress: "invalid" })
      );
    }
  });

  it("uses documented development loopback and maps routine failures/retries safely", async () => {
    vi.stubEnv("NODE_ENV", "development");
    state.requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.10" });
    state.register
      .mockResolvedValueOnce({ ok: false, error: "server_error" })
      .mockResolvedValueOnce({ ok: false, error: "already_registered" });
    await expect(
      registerForEventAction(initialRegisterActionState, form())
    ).resolves.toEqual({ status: "error", error: "server_error" });
    await expect(
      registerForEventAction(initialRegisterActionState, form())
    ).resolves.toEqual({ status: "error", error: "already_registered" });
    expect(state.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
  });
});
