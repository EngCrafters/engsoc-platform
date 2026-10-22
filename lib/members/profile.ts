import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The signed-in member's own profile (ADR 0023). Every routine takes the identity Supabase Auth
 * verified for this request and answers only for it; nothing here accepts a member ID from the
 * request.
 */
export const DISCIPLINES = [
  "mechanical",
  "electrical",
  "civil",
  "petroleum",
  "chemical",
  "mechatronics",
  "industrial",
] as const;
export const INTERESTS = [
  "cad",
  "simulation",
  "embedded",
  "robotics",
  "structures",
  "process",
  "data",
  "programming",
  "power",
  "reservoir",
  "quality",
  "management",
  "sustainability",
  "hse",
] as const;

/**
 * Developer switches (static deployment configuration, never the dashboard). They mirror the
 * website's config/site-features.json `profile` block; the API enforces its own copy so a
 * disabled feature has no open endpoint.
 */
export function memberFeatures() {
  return {
    photoUploads: process.env.MEMBER_PHOTO_UPLOADS?.trim() !== "disabled",
    profileEditing: process.env.MEMBER_PROFILE_EDITING?.trim() !== "disabled",
  };
}

type Result = { code: string; field?: string } & Record<string, unknown>;

async function call(query: ReturnType<typeof sql>): Promise<Result> {
  const rows = await db.execute<{ result: Result }>(query);
  if (!rows.length) throw new Error("Member profile operation unavailable");
  return rows[0].result;
}

/** Only known identifiers ever reach this literal; the routes validate first. */
const textArray = (values: readonly string[]) => `{${values.join(",")}}`;

export const ownProfile = (actor: string) =>
  call(sql`SELECT private.get_own_profile(${actor}::uuid) AS result`);

export const updateOwnProfile = (
  actor: string,
  input: {
    phone: string | null;
    academicYear: number;
    discipline: string;
    interests: readonly string[];
  }
) =>
  call(
    sql`SELECT private.update_own_profile(${actor}::uuid, ${input.phone}, ${input.academicYear}::integer, ${input.discipline}, ${textArray(input.interests)}::text[]) AS result`
  );

export const setOwnPhoto = (actor: string, key: string | null) =>
  call(sql`SELECT private.set_own_photo(${actor}::uuid, ${key}) AS result`);

export async function ownPhotoKey(actor: string): Promise<string | null> {
  const rows = await db.execute<{ key: string | null }>(
    sql`SELECT private.get_own_photo_key(${actor}::uuid) AS key`
  );
  return rows[0]?.key ?? null;
}

export const ownRegistrations = (actor: string) =>
  call(sql`SELECT private.list_own_registrations(${actor}::uuid) AS result`);

export const requestProfileChange = (
  actor: string,
  field: "full_name" | "university_id",
  value: string
) =>
  call(
    sql`SELECT private.request_profile_change(${actor}::uuid, ${field}, ${value}) AS result`
  );

export type ProfileChangeRequest = {
  id: string;
  field: "full_name" | "university_id";
  requestedValue: string;
  currentValue: string;
  requestedAt: string;
  memberName: string;
  memberEmail: string;
  isOwn: boolean;
};

export async function profileChangeRequests(actor: string) {
  const result = await call(
    sql`SELECT private.list_profile_change_requests(${actor}::uuid) AS result`
  );
  return result.code === "SUCCESS"
    ? (result.requests as ProfileChangeRequest[])
    : null;
}

export const decideProfileChange = (
  actor: string,
  request: string,
  decision: "approve" | "reject",
  note: string | null
) =>
  call(
    sql`SELECT private.decide_profile_change(${actor}::uuid, ${request}::uuid, ${decision}, ${note}) AS result`
  );
