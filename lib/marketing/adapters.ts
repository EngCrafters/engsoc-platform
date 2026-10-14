import type { PublicEvent } from "@/lib/events";
import type { Dictionary } from "@/lib/i18n";

/**
 * The seam between the canonical event domain and public presentation.
 *
 * `lib/events` owns the data contract: a narrow, already-safe DTO whose
 * `availability` is derived inside the database. This adapter only renames and
 * formats for the marketing surface. It contains no authorization decision, no
 * persistence, and it never widens the DTO — internal fields such as status,
 * capacity, counts, revision or committee id are not available to it and must
 * not be invented here.
 */

export interface MarketingEventCardModel {
  id: string;
  href: string;
  title: string;
  description: string;
  committeeName: string;
  location: string | null;
  /** Pre-formatted for the active locale, in the society's own time zone. */
  dateLabel: string;
  /** Short form for dense lists. */
  dateShort: string;
  /** The ISO instant, for a machine-readable <time dateTime>. */
  dateIso: string;
  availability: PublicEvent["availability"];
  availabilityLabel: string;
}

/**
 * Event dates are always shown in Oman time regardless of where the page is
 * rendered or read — the same rule the platform already applies in
 * lib/events/format.ts. Only the language changes here.
 */
export function formatEventDate(date: Date, intl: string, detail = false) {
  return new Intl.DateTimeFormat(intl, {
    ...(detail ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: detail ? "long" : "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Muscat",
    timeZoneName: "short",
  }).format(date);
}

export function availabilityLabel(
  t: Dictionary,
  availability: PublicEvent["availability"]
) {
  return t.events.availability[availability];
}

export function toMarketingEventCard(
  event: PublicEvent,
  t: Dictionary,
  intl: string
): MarketingEventCardModel {
  return {
    id: event.id,
    href: `/events/${event.id}`,
    title: event.title,
    description: event.description,
    committeeName: event.committeeName,
    location: event.location,
    dateLabel: formatEventDate(event.eventDate, intl, true),
    dateShort: formatEventDate(event.eventDate, intl),
    dateIso: event.eventDate.toISOString(),
    availability: event.availability,
    availabilityLabel: availabilityLabel(t, event.availability),
  };
}
