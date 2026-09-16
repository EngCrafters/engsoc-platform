// Hidden implementation of the events domain — queries against
// db/schema.ts's `events` table. Nothing outside lib/events/ should import
// this file directly; go through index.ts instead.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { PublicEvent, PublicEventAvailability } from "./types";

type PublicEventRow = {
  id: string;
  title: string;
  description: string;
  event_date: string;
  location: string | null;
  committee_name: string;
  availability: PublicEventAvailability;
};

function mapPublicEvent(row: PublicEventRow): PublicEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventDate: new Date(row.event_date),
    location: row.location,
    committeeName: row.committee_name,
    availability: row.availability,
  };
}

export async function selectPublicEvents(input: {
  period: "upcoming" | "past";
  cursor?: { eventDate: Date; id: string };
  limit: number;
}): Promise<PublicEvent[]> {
  const rows = await db.execute<PublicEventRow>(sql`
    select * from private.list_public_events(
      ${input.period},
      ${input.cursor?.eventDate.toISOString() ?? null}::timestamptz,
      ${input.cursor?.id ?? null}::uuid, ${input.limit}
    )
  `);
  return rows.map(mapPublicEvent);
}

export async function selectPublicEvent(
  eventId: string
): Promise<PublicEvent | null> {
  const rows = await db.execute<PublicEventRow>(sql`
    select * from private.get_public_event(${eventId}::uuid)
  `);
  return rows[0] ? mapPublicEvent(rows[0]) : null;
}
