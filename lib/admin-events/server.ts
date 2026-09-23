import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  type AdminEvent,
  type AdminEventCursor,
  type AdminEventFilter,
  ADMIN_EVENT_PAGE_SIZE,
} from "./types";

export type { AdminEvent } from "./types";

type AdminEventRow = Omit<
  AdminEvent,
  | "eventDate"
  | "committeeId"
  | "committeeName"
  | "archivedAt"
  | "reviewRequired"
  | "flaggedBy"
  | "approvedBy"
  | "confirmedCount"
  | "waitlistedCount"
> & {
  event_date: string;
  committee_id: string;
  committee_name: string;
  archived_at: string | null;
  review_required: boolean;
  flagged_by: string | null;
  approved_by: string | null;
  confirmed_count: number;
  waitlisted_count: number;
};

function map(row: AdminEventRow): AdminEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventDate: row.event_date,
    location: row.location,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    status: row.status,
    capacity: row.capacity,
    revision: row.revision,
    archivedAt: row.archived_at,
    reviewRequired: row.review_required,
    flaggedBy: row.flagged_by,
    approvedBy: row.approved_by,
    confirmedCount: row.confirmed_count,
    waitlistedCount: row.waitlisted_count,
  };
}

export type { AdminEventCursor } from "./types";

export type AdminEventList = {
  events: AdminEvent[];
  nextCursor: AdminEventCursor | null;
};

export async function listAdminEvents(
  actorId: string,
  options: {
    committeeId: string | null;
    filter: AdminEventFilter;
    cursor: AdminEventCursor | null;
  }
): Promise<AdminEventList> {
  const rows = await db.execute<AdminEventRow>(
    sql`SELECT * FROM private.list_admin_events(
      ${actorId}::uuid,
      ${options.committeeId}::uuid,
      ${options.filter}::text,
      ${options.cursor?.eventDate ?? null}::timestamptz,
      ${options.cursor?.id ?? null}::uuid,
      ${ADMIN_EVENT_PAGE_SIZE + 1}::integer
    )`
  );
  const hasNextPage = rows.length > ADMIN_EVENT_PAGE_SIZE;
  const events = rows.slice(0, ADMIN_EVENT_PAGE_SIZE).map(map);
  const finalEvent = events.at(-1);
  return {
    events,
    nextCursor:
      hasNextPage && finalEvent
        ? { eventDate: finalEvent.eventDate, id: finalEvent.id }
        : null,
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads one event through the same fixed routine path and grant check as the
 * list, so an event the list shows a manager can always be opened by them. A
 * malformed id, a missing event and an out-of-scope event all return null (the
 * page renders 404); a malformed id never reaches the database.
 */
export async function getAdminEvent(
  actorId: string,
  eventId: string
): Promise<AdminEvent | null> {
  if (!UUID_PATTERN.test(eventId)) return null;
  const rows = await db.execute<AdminEventRow>(
    sql`SELECT * FROM private.get_admin_event(${actorId}::uuid, ${eventId}::uuid)`
  );
  const row = rows[0];
  return row ? map(row) : null;
}

export async function writeAdminEvent(
  routine: "create_event" | "edit_event",
  values: (string | number | null)[]
) {
  const rows =
    routine === "create_event"
      ? await db.execute<{
          result: { code: string; eventId?: string; revision?: number };
        }>(
          sql`SELECT private.create_event(${values[0]}::uuid, ${values[1]}::uuid, ${values[2]}::text, ${values[3]}::text, ${values[4]}::timestamptz, ${values[5]}::text, ${values[6]}::integer) AS result`
        )
      : await db.execute<{
          result: { code: string; eventId?: string; revision?: number };
        }>(
          sql`SELECT private.edit_event(${values[0]}::uuid, ${values[1]}::uuid, ${values[2]}::integer, ${values[3]}::text, ${values[4]}::text, ${values[5]}::timestamptz, ${values[6]}::text, ${values[7]}::integer) AS result`
        );
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export type LifecycleOperation =
  | "flag_review"
  | "unflag_review"
  | "approve_event"
  | "publish_event"
  | "hold_event_full"
  | "reopen_event"
  | "archive_event"
  | "restore_event";

export async function writeLifecycleEvent(
  operation: LifecycleOperation,
  actorId: string,
  eventId: string,
  revision: number
) {
  const result =
    operation === "flag_review" || operation === "unflag_review"
      ? await db.execute<{ result: { code: string; revision?: number } }>(
          sql`SELECT private.flag_review(${actorId}::uuid, ${eventId}::uuid, ${revision}::integer, ${operation === "flag_review"}) AS result`
        )
      : operation === "approve_event"
        ? await db.execute<{ result: { code: string; revision?: number } }>(
            sql`SELECT private.approve_event(${actorId}::uuid, ${eventId}::uuid, ${revision}::integer) AS result`
          )
        : operation === "publish_event" || operation === "reopen_event"
          ? await db.execute<{ result: { code: string; revision?: number } }>(
              sql`SELECT private.publish_event(${actorId}::uuid, ${eventId}::uuid, ${revision}::integer) AS result`
            )
          : operation === "hold_event_full"
            ? await db.execute<{ result: { code: string; revision?: number } }>(
                sql`SELECT private.hold_event_full(${actorId}::uuid, ${eventId}::uuid, ${revision}::integer) AS result`
              )
            : operation === "archive_event"
              ? await db.execute<{
                  result: { code: string; revision?: number };
                }>(
                  sql`SELECT private.archive_event(${actorId}::uuid, ${eventId}::uuid, ${revision}::integer) AS result`
                )
              : await db.execute<{
                  result: { code: string; revision?: number };
                }>(
                  sql`SELECT private.restore_event(${actorId}::uuid, ${eventId}::uuid, ${revision}::integer) AS result`
                );
  return result[0]?.result ?? { code: "SERVER_ERROR" };
}
