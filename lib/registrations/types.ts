// Shared types for the registrations domain. Re-exported from index.ts.

/**
 * What the Server Action needs to attempt a registration. `ipAddress` isn't
 * user input — the caller (the Server Action) reads it from request headers
 * and passes it in for rate limiting; see docs/adr/0005.
 */
export type RegisterForEventInput = {
  eventId: string;
  attendeeName: string;
  attendeeEmail: string;
  ipAddress: string;
};

/**
 * Maps directly onto UC-02's flows:
 * - "event_not_published" / "event_full" are the two named exception
 *   flows ("Approval required" and "Event full").
 * - "rate_limited" is docs/adr/0005's abuse protection, not in the use
 *   case doc itself.
 * - "invalid_name" / "invalid_email" / "invalid_event" are basic input
 *   validation, not a use-case flow, just the minimum needed before
 *   trusting the input enough to write it.
 * - "already_registered" surfaces the partial unique index added in M2
 *   (docs/UC-02_Data_and_Security.md section 3) — a genuine concurrent
 *   duplicate insert, not something this code decides on its own.
 */
export type RegisterForEventError =
  | "invalid_name"
  | "invalid_email"
  | "invalid_event"
  | "event_not_found"
  | "event_not_published"
  | "event_full"
  | "rate_limited"
  | "already_registered";

export type RegisterForEventResult =
  { ok: true } | { ok: false; error: RegisterForEventError };
