// Shared types for the events domain. Re-exported from index.ts.

/**
 * The public-facing shape of an event — what a visitor is allowed to see.
 * Deliberately narrower than the raw `events` row in db/schema.ts: it drops
 * `committeeId` (internal) and `status` (a visitor never sees a draft or
 * full event distinctly here, `getPublishedEvents` already filters for
 * "published" before this shape is built).
 */
export type PublicEventAvailability = "open" | "waitlist" | "closed";

export type PublicEvent = {
  id: string;
  title: string;
  description: string;
  eventDate: Date;
  location: string | null;
  committeeName: string;
  availability: PublicEventAvailability;
};

export type PublicEventPage = {
  events: PublicEvent[];
  nextCursor: string | null;
};
