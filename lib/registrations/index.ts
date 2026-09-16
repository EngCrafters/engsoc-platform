// Public entry point for the accountless UC-02 registration boundary.

export * from "./types";

import { isIP } from "node:net";
import { registerThroughRoutine } from "./db";
import type { RegisterForEventInput, RegisterForEventResult } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

export async function registerForEvent(
  input: RegisterForEventInput
): Promise<RegisterForEventResult> {
  const attendeeName = input.attendeeName.trim();
  const attendeeEmail = input.attendeeEmail.trim().toLowerCase();
  const intent = input.intent ?? "register";

  if (
    attendeeName.length === 0 ||
    attendeeName.length > MAX_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(attendeeName)
  ) {
    return { ok: false, error: "invalid_name" };
  }
  if (
    attendeeEmail.length > 254 ||
    !EMAIL_PATTERN.test(attendeeEmail) ||
    /[\u0000-\u001f\u007f]/.test(attendeeEmail)
  ) {
    return { ok: false, error: "invalid_email" };
  }
  if (!UUID_PATTERN.test(input.eventId)) {
    return { ok: false, error: "invalid_event" };
  }
  if (intent !== "register" && intent !== "join_waitlist") {
    return { ok: false, error: "invalid_intent" };
  }
  if (isIP(input.ipAddress) === 0) {
    return { ok: false, error: "invalid_ip" };
  }

  try {
    const result = await registerThroughRoutine({
      eventId: input.eventId,
      attendeeName,
      attendeeEmail,
      intent,
      ipAddress: input.ipAddress,
    });
    switch (result.code) {
      case "SUCCESS":
        return { ok: true };
      case "WAITLISTED":
        return { ok: true, waitlisted: true };
      case "ALREADY_REGISTERED":
        return { ok: false, error: "already_registered" };
      case "ALREADY_WAITLISTED":
        return { ok: false, error: "already_waitlisted" };
      case "EVENT_NOT_FOUND":
        return { ok: false, error: "event_not_found" };
      case "REGISTRATION_CLOSED":
        return { ok: false, error: "registration_closed" };
      case "EVENT_FULL":
        return { ok: false, error: "event_full" };
      case "REGISTRATION_AVAILABLE":
        return { ok: false, error: "registration_available" };
      case "RATE_LIMITED":
        return { ok: false, error: "rate_limited" };
      case "VALIDATION_ERROR":
        return { ok: false, error: "invalid_input" };
      default:
        return { ok: false, error: "server_error" };
    }
  } catch {
    return { ok: false, error: "server_error" };
  }
}
