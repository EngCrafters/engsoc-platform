// Hidden implementation of the events domain — queries against
// db/schema.ts's `events` table. Nothing outside lib/events/ should import
// this file directly; go through index.ts instead.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import type { PublishedEvent } from "./types";

export async function selectPublishedEvents(): Promise<PublishedEvent[]> {
  return db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      eventDate: events.eventDate,
      location: events.location,
    })
    .from(events)
    .where(eq(events.status, "published"))
    .orderBy(asc(events.eventDate));
}
