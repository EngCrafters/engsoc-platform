// Public entry point for the registrations domain. Code outside
// lib/registrations/ must import from here, never from ./db or ./types
// directly — that's what keeps this a deep module: the domain's
// implementation can change shape without every caller needing to know.

export * from "./types";

import {
  countRecentAttempts,
  findEventForRegistration,
  insertRegistration,
  recordAttempt,
  RATE_LIMIT_MAX_ATTEMPTS,
} from "./db";
import type { RegisterForEventInput, RegisterForEventResult } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 200;

/**
 * UC-02's registration step (main flow, steps 3-5): validate the visitor's
 * input, apply the rate limit from docs/adr/0005, then write directly into
 * `registrations` with no Member row required. Called by the Server Action
 * in app/(marketing)/actions.ts — this function has no framework-specific
 * code in it (no FormData, no headers()), so it stays testable and reusable
 * outside a Server Action if that's ever needed.
 */
export async function registerForEvent(
  input: RegisterForEventInput
): Promise<RegisterForEventResult> {
  // Rate limit check first, using the count *before* this attempt, then
  // record this attempt regardless of outcome — see docs/adr/0005,
  // "A row is written for every attempt (allowed or rejected)."
  const recentAttempts = await countRecentAttempts(input.ipAddress);
  await recordAttempt(input.ipAddress);
  if (recentAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { ok: false, error: "rate_limited" };
  }

  const attendeeName = input.attendeeName.trim();
  if (attendeeName.length === 0 || attendeeName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "invalid_name" };
  }

  const attendeeEmail = input.attendeeEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(attendeeEmail)) {
    return { ok: false, error: "invalid_email" };
  }

  if (!UUID_PATTERN.test(input.eventId)) {
    return { ok: false, error: "invalid_event" };
  }

  const event = await findEventForRegistration(input.eventId);
  if (!event) {
    return { ok: false, error: "event_not_found" };
  }
  // UC-02 exception flow, "Approval required": a draft hasn't been
  // approved to go live yet, so it isn't open for registration.
  if (event.status === "draft") {
    return { ok: false, error: "event_not_published" };
  }
  // UC-02 exception flow, "Event full": the doc describes a waitlist here.
  // No waitlist entity exists yet (see docs/adr/0004's rejection of adding
  // entities speculatively) — for now, registration is simply closed once
  // an event is marked full. Revisit when waitlisting is a written decision.
  if (event.status === "full") {
    return { ok: false, error: "event_full" };
  }

  await insertRegistration({
    eventId: input.eventId,
    attendeeName,
    attendeeEmail,
  });
  return { ok: true };
}
