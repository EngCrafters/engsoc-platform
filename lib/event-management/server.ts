import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type EventOptions = {
  coverImageKey: string | null;
  phoneRequired: boolean;
};
export type MemberProfile = {
  code: string;
  name: string;
  email: string;
  phone: string | null;
};
export type MemberEvent = {
  code: string;
  profile: MemberProfile;
  registration: {
    status: "confirmed" | "waitlisted";
    attended: boolean;
    checkedInAt: string | null;
  } | null;
  checkinOpen: boolean;
  closesAt: string | null;
};
export type AttendanceRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  attended: boolean;
  checkedInAt: string | null;
  registeredAt: string;
};
export type AttendanceList = {
  code: string;
  rows: AttendanceRow[];
  total: number;
  confirmed: number;
  attended: number;
  waitlisted: number;
};
export type CheckinSession = {
  code: string;
  isOpen: boolean;
  closesAt: string | null;
  challengeExpiresAt: string | null;
  challenge?: string;
};

async function result<T>(query: ReturnType<typeof sql>): Promise<T> {
  const rows = await db.execute<{ result: T }>(query);
  if (!rows.length) throw new Error("Event operation unavailable");
  return rows[0].result;
}

export function adminEventOptions(actor: string, event: string) {
  return result<EventOptions | null>(
    sql`SELECT private.admin_event_options(${actor}::uuid,${event}::uuid) AS result`
  );
}

export async function publicEventOptions(ids: string[]) {
  if (!ids.length) return new Map<string, EventOptions>();
  const rows = await db.execute<{
    id: string;
    cover_image_key: string | null;
    phone_required: boolean;
  }>(
    sql`SELECT * FROM private.public_event_options(${`{${ids.join(",")}}`}::uuid[])`
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { coverImageKey: row.cover_image_key, phoneRequired: row.phone_required },
    ])
  );
}

export function coverImageUrl(
  eventId: string,
  key: string | null
): string | null {
  // Relative to the v1 base; the website resolves it against its configured Core.
  return key ? `/v1/events/${eventId}/image?v=${key.split("/").at(-1)}` : null;
}

export function saveEventDetails(values: (string | number | boolean | null)[]) {
  return result<{
    code: string;
    eventId?: string;
    revision?: number;
  }>(sql`SELECT private.save_event_details(
    ${values[0]}::uuid,${values[1]}::uuid,${values[2]}::uuid,${values[3]}::integer,
    ${values[4]}::text,${values[5]}::text,${values[6]}::timestamptz,${values[7]}::text,
    ${values[8]}::integer,${values[9]}::text,${values[10]}::boolean) AS result`);
}

export function memberProfile(actor: string) {
  return result<MemberProfile>(
    sql`SELECT private.get_member_profile(${actor}::uuid) AS result`
  );
}
export function updatePhone(actor: string, phone: string) {
  return result<MemberProfile>(
    sql`SELECT private.update_member_phone(${actor}::uuid,${phone}) AS result`
  );
}
export function memberEvent(actor: string, event: string) {
  return result<MemberEvent>(
    sql`SELECT private.get_member_event(${actor}::uuid,${event}::uuid) AS result`
  );
}
export function registerMember(
  actor: string,
  event: string,
  intent: string,
  ip: string
) {
  return result<{ code: string }>(
    sql`SELECT private.register_event_member(${actor}::uuid,${event}::uuid,${intent},${ip}::inet) AS result`
  );
}
export function confirmAttendance(
  actor: string,
  event: string,
  challenge: string
) {
  const hash = createHash("sha256").update(challenge).digest("hex");
  return result<{
    code: string;
    checkedInAt?: string;
    alreadyAttended?: boolean;
  }>(
    sql`SELECT private.confirm_member_attendance(${actor}::uuid,${event}::uuid,${hash}) AS result`
  );
}
export async function manageCheckin(
  actor: string,
  event: string,
  operation: string,
  closesAt: string | null = null
) {
  const challenge =
    operation === "open" || operation === "rotate"
      ? randomBytes(32).toString("hex")
      : null;
  const hash = challenge
    ? createHash("sha256").update(challenge).digest("hex")
    : null;
  const data = await result<CheckinSession>(
    sql`SELECT private.manage_event_checkin(${actor}::uuid,${event}::uuid,${operation},${hash},${closesAt}::timestamptz) AS result`
  );
  return data.code === "SUCCESS" && challenge ? { ...data, challenge } : data;
}
export function listAttendance(
  actor: string,
  event: string,
  filter = "all",
  search = "",
  after: string | null = null,
  limit = 51,
  exporting = false
) {
  return result<AttendanceList>(
    sql`SELECT private.list_event_attendance(${actor}::uuid,${event}::uuid,${filter},${search},${after}::uuid,${limit},${exporting}) AS result`
  );
}
