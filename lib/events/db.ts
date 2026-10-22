// Hidden implementation of the events domain — queries against
// db/schema.ts's `events` table. Nothing outside lib/events/ should import
// this file directly; go through index.ts instead.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { PublicEvent, PublicEventAvailability } from "./types";
import { coverImageUrl } from "@/lib/event-management/server";

type PublicEventRow = {
  id: string;
  title: string;
  description: string;
  event_date: string;
  location: string | null;
  committee_name: string;
  availability: PublicEventAvailability;
  cover_image_key?: string | null;
  phone_required?: boolean;
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
    coverImageUrl: coverImageUrl(row.id, row.cover_image_key ?? null),
    phoneRequired: row.phone_required ?? false,
  };
}

export async function selectPublicEvents(input: {
  period: "upcoming" | "past";
  cursor?: { eventDate: string; id: string };
  limit: number;
}): Promise<{ event: PublicEvent; cursorDate: string }[]> {
  // Text on both sides preserves PostgreSQL microseconds. Without the input
  // text cast postgres-js may apply its timestamptz Date serializer and truncate
  // an otherwise precise string to milliseconds before sending the parameter.
  const rows = await db.execute<PublicEventRow>(sql`
    select id, title, description, event_date::text as event_date,
      location, committee_name, availability, o.cover_image_key, o.phone_required
    from private.list_public_events(
      ${input.period},
      ${input.cursor?.eventDate ?? null}::text::timestamptz,
      ${input.cursor?.id ?? null}::uuid, ${input.limit}
    ) p LEFT JOIN LATERAL private.public_event_options(ARRAY[p.id]) o USING(id)
  `);
  return rows.map((row) => ({
    event: mapPublicEvent(row),
    cursorDate: row.event_date,
  }));
}

export async function selectPublicEvent(
  eventId: string
): Promise<PublicEvent | null> {
  const rows = await db.execute<PublicEventRow>(sql`
    select p.*, o.cover_image_key, o.phone_required from private.get_public_event(${eventId}::uuid) p
    LEFT JOIN LATERAL private.public_event_options(ARRAY[p.id]) o USING(id)
  `);
  return rows[0] ? mapPublicEvent(rows[0]) : null;
}
