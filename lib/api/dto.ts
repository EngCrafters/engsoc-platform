import "server-only";

import type { PublicEvent, PublicEventPage } from "@/lib/events";
import type { RegistrationConflictReason } from "@/lib/api/problems";
import type {
  RegisterForEventError,
  RegisterForEventResult,
} from "@/lib/registrations";

/**
 * The external contract of the public API, in one place.
 *
 * The domain shape is deliberately wider than the wire shape is allowed to be.
 * `PublicEvent` is already narrowed for visitors, but the wire contract is a
 * *published* promise: it must not gain a field because an internal type
 * changed. These functions are the only place the two meet.
 */

export type EventDto = {
  id: string;
  title: string;
  description: string;
  eventDate: string;
  location: string | null;
  committeeName: string;
  availability: PublicEvent["availability"];
  coverImageUrl: string | null;
  phoneRequired: boolean;
};

export type EventListDto = {
  data: EventDto[];
  meta: { nextCursor: string | null };
};

/**
 * Map a domain event to the wire shape.
 *
 * The field list is explicit rather than spread, so an added domain field is
 * invisible here until someone changes this function deliberately. That is the
 * whole point: no internal field can leak by accident.
 */
export function toEventDto(event: PublicEvent): EventDto {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    eventDate: event.eventDate.toISOString(),
    location: event.location,
    committeeName: event.committeeName,
    availability: event.availability,
    coverImageUrl: event.coverImageUrl ?? null,
    phoneRequired: event.phoneRequired ?? false,
  };
}

export function toEventListDto(page: PublicEventPage): EventListDto {
  return {
    data: page.events.map(toEventDto),
    meta: { nextCursor: page.nextCursor },
  };
}

export type RegistrationStatusDto = "confirmed" | "waitlisted";

export type RegistrationDto = { data: { status: RegistrationStatusDto } };

/**
 * Map a canonical domain error to a public error code.
 *
 * The mapping is exhaustive over `RegisterForEventError`, so adding a domain
 * error is a compile error here rather than a silent 500. The public vocabulary
 * remains stable; registration conflicts can additionally carry a fixed public
 * reason through `registrationConflictReasonFor`.
 */
export function publicCodeFor(
  error: RegisterForEventError
):
  | "invalid-fields"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "service-unavailable" {
  switch (error) {
    case "invalid_name":
    case "invalid_email":
    case "invalid_event":
    case "invalid_input":
    case "invalid_intent":
    case "phone_required":
      return "invalid-fields";
    case "event_not_found":
    case "event_not_published":
      return "not-found";
    case "already_registered":
    case "already_waitlisted":
    case "event_full":
    case "registration_closed":
    case "registration_available":
      return "conflict";
    case "rate_limited":
      return "rate-limited";
    case "invalid_ip":
    case "server_error":
      return "service-unavailable";
  }
}

export function toRegistrationDto(
  result: Extract<RegisterForEventResult, { ok: true }>
): RegistrationDto {
  return {
    data: { status: result.waitlisted === true ? "waitlisted" : "confirmed" },
  };
}

/** Translate existing domain outcomes without duplicating registration rules. */
export function registrationConflictReasonFor(
  error: RegisterForEventError
): RegistrationConflictReason | undefined {
  switch (error) {
    case "already_registered":
      return "already-registered";
    case "already_waitlisted":
      return "already-waitlisted";
    case "event_full":
      return "event-full";
    case "registration_closed":
      return "registration-closed";
    case "registration_available":
      return "registration-available";
    default:
      return undefined;
  }
}

/** True when the failure is the caller's fault, which also affects caching. */
export function isClientError(code: ReturnType<typeof publicCodeFor>): boolean {
  return code === "invalid-fields" || code === "not-found";
}
