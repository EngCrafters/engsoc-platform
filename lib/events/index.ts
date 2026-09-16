// Public entry point for the events domain. Code outside lib/events/ must
// import from here, never from ./db or ./types directly — that's what keeps
// this a deep module: the domain's implementation can change shape without
// every caller needing to know.

export * from "./types";

import { selectPublishedEvent, selectPublishedEvents } from "./db";
import type { PublicEvent, PublishedEvent } from "./types";

/**
 * Every published event, soonest first. UC-02's main flow, step 2: "The
 * event appears live on the public events page." This is the single
 * function both the public marketing site and any future internal events
 * view call — see app/(marketing)/page.tsx for a Server Component using it
 * directly, no fetch() or API route in between.
 */
export async function getPublishedEvents(): Promise<PublishedEvent[]> {
  return selectPublishedEvents();
}

export async function getPublishedEvent(
  eventId: string
): Promise<PublicEvent | null> {
  return selectPublishedEvent(eventId);
}
