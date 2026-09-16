// Hidden implementation of the events domain — queries against
// db/schema.ts's `events` table. Nothing outside lib/events/ should import
// this file directly; go through index.ts instead.

import { supabasePublicServer } from "@/lib/supabase";
import type { PublicEvent, PublishedEvent } from "./types";

type PublicEventRow = {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  location: string | null;
  status?: "published" | "full";
};

function mapPublicEvent(row: PublicEventRow): PublishedEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventDate: new Date(row.event_date),
    location: row.location,
  };
}

export async function selectPublishedEvents(): Promise<PublishedEvent[]> {
  const { data, error } = await supabasePublicServer()
    .from("events")
    .select("id,title,description,event_date,location")
    .order("event_date", { ascending: true });
  if (error) throw new Error("PUBLIC_EVENT_READ_FAILED");
  return (data as PublicEventRow[]).map(mapPublicEvent);
}

export async function selectPublishedEvent(
  eventId: string
): Promise<PublicEvent | null> {
  const { data, error } = await supabasePublicServer()
    .from("events")
    .select("id,title,description,event_date,location")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error("PUBLIC_EVENT_READ_FAILED");
  if (!data) return null;
  const row = data as PublicEventRow;
  return {
    ...mapPublicEvent(row),
    // Full/open is intentionally resolved by the registration routine at
    // submit time. The public projection does not expose internal status.
    registrationState: "open",
  };
}
