import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ADMIN_REGISTRATION_PAGE_SIZE,
  type AdminRegistration,
  type AdminRegistrationCursor,
  type AdminRegistrationStatus,
} from "./types";

type Row = {
  id: string;
  attendee_name: string;
  attendee_email: string;
  status: AdminRegistrationStatus;
  registered_at: string;
};
function map(row: Row): AdminRegistration {
  return {
    id: row.id,
    attendeeName: row.attendee_name,
    attendeeEmail: row.attendee_email,
    status: row.status,
    registeredAt: row.registered_at,
  };
}

export async function listAdminRegistrations(
  actorId: string,
  eventId: string,
  status: AdminRegistrationStatus,
  cursor: AdminRegistrationCursor | null
) {
  const rows = await db.execute<Row>(
    sql`SELECT * FROM private.list_admin_registrations(${actorId}::uuid, ${eventId}::uuid, ${status}::text, ${cursor?.registeredAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid, ${ADMIN_REGISTRATION_PAGE_SIZE + 1}::integer)`
  );
  const page = rows.slice(0, ADMIN_REGISTRATION_PAGE_SIZE).map(map);
  const last = page.at(-1);
  return {
    registrations: page,
    nextCursor:
      rows.length > ADMIN_REGISTRATION_PAGE_SIZE && last
        ? { registeredAt: last.registeredAt, id: last.id }
        : null,
  };
}

export async function countAdminRegistrations(
  actorId: string,
  eventId: string
) {
  const rows = await db.execute<{
    confirmed_count: number;
    waitlisted_count: number;
  }>(
    sql`SELECT * FROM private.count_admin_registrations(${actorId}::uuid, ${eventId}::uuid)`
  );
  return rows[0] ?? null;
}

export async function promoteWaitlist(
  actorId: string,
  eventId: string,
  registrationId: string
) {
  const rows = await db.execute<{ result: { code: string } }>(
    sql`SELECT private.promote_waitlist(${actorId}::uuid, ${eventId}::uuid, ${registrationId}::uuid, true) AS result`
  );
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export async function exportAdminRegistrations(
  actorId: string,
  eventId: string,
  status: AdminRegistrationStatus
) {
  const rows = await db.execute<Row>(
    sql`SELECT * FROM private.export_admin_registrations(${actorId}::uuid, ${eventId}::uuid, ${status}::text)`
  );
  return rows.map(map);
}
