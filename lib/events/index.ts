// Public entry point for the events domain. Code outside lib/events/ must
// import from here, never from ./db or ./types directly — that's what keeps
// this a deep module: the domain's implementation can change shape without
// every caller needing to know.

export * from "./types";

import { selectPublicEvent, selectPublicEvents } from "./db";
import type { PublicEvent, PublicEventPage } from "./types";

/**
 * Every published event, soonest first. UC-02's main flow, step 2: "The
 * event appears live on the public events page." This is the single
 * function both the public marketing site and any future internal events
 * view call — see app/(marketing)/page.tsx for a Server Component using it
 * directly, no fetch() or API route in between.
 */
const PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Cursor = {
  v: 1;
  period: "upcoming" | "past";
  date: string;
  id: string;
};

function decodeCursor(value: string | undefined, period: Cursor["period"]) {
  if (!value || value.length > 1366) return undefined;
  try {
    const cursor = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Cursor;
    if (
      cursor.v !== 1 ||
      cursor.period !== period ||
      !UUID.test(cursor.id) ||
      !Number.isFinite(new Date(cursor.date).getTime())
    )
      return undefined;
    return { eventDate: new Date(cursor.date), id: cursor.id };
  } catch {
    return undefined;
  }
}

function encodeCursor(event: PublicEvent, period: Cursor["period"]) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      period,
      date: event.eventDate.toISOString(),
      id: event.id,
    })
  ).toString("base64url");
}

export async function getPublicEventPage(input: {
  period: "upcoming" | "past";
  cursor?: string;
}): Promise<PublicEventPage> {
  const events = await selectPublicEvents({
    period: input.period,
    cursor: decodeCursor(input.cursor, input.period),
    limit: PAGE_SIZE + 1,
  });
  const hasNext = events.length > PAGE_SIZE;
  const page = hasNext ? events.slice(0, PAGE_SIZE) : events;
  const last = page.at(-1);
  return {
    events: page,
    nextCursor: hasNext && last ? encodeCursor(last, input.period) : null,
  };
}

export async function getPublicEvent(
  eventId: string
): Promise<PublicEvent | null> {
  if (!UUID.test(eventId)) return null;
  return selectPublicEvent(eventId);
}
