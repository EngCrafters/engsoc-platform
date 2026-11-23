// Server-only access to the verification, leadership and team routines of
// migration 0033 (ADR 0025). The runtime role has no table privileges: every
// call is one fixed routine, which re-checks the actor's authority itself. The
// actor is always the identity Core verified for the request, never a value
// from the request.

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { withRecoveryGuard } from "@/lib/auth/recovery";
import type { CodeResult } from "./types";

async function routine<T = CodeResult>(query: SQL): Promise<T> {
  // A revocation that would remove the last recovery account fails as a whole (migration 0035).
  const rows = await withRecoveryGuard(() => db.execute<{ result: T }>(query));
  if (!Array.isArray(rows)) return rows as T;
  if (!rows.length) throw new Error("Verification routine unavailable");
  return rows[0].result;
}

const timestamp = (value: Date | null) => value?.toISOString() ?? null;

// ---------------------------------------------------------------------------
// The member's own view and requests
// ---------------------------------------------------------------------------
// Two routines on purpose: the profile's two cards load, and fail, separately.
export const ownSquThroughRoutine = (actor: string) =>
  routine(
    sql`SELECT private.get_own_squ_verification(${actor}::uuid) AS result`
  );

export const ownLeadershipThroughRoutine = (actor: string) =>
  routine(sql`SELECT private.get_own_leadership(${actor}::uuid) AS result`);

export const beginSquThroughRoutine = (actor: string) =>
  routine(sql`SELECT private.begin_squ_verification(${actor}::uuid) AS result`);

export const submitSquThroughRoutine = (
  actor: string,
  input: {
    studentNumber: string;
    mediaType: string;
    sha256: string;
    byteSize: number;
    content: Buffer | null;
    storageBucket: string | null;
    storageKey: string | null;
  }
) =>
  routine(sql`
    SELECT private.submit_squ_verification(
      ${actor}::uuid, ${input.studentNumber}, ${input.mediaType}, ${input.sha256},
      ${input.byteSize}::integer, ${input.content}::bytea, ${input.storageBucket},
      ${input.storageKey}
    ) AS result
  `);

export const queueAbandonedSquThroughRoutine = (bucket: string, key: string) =>
  routine(
    sql`SELECT private.queue_abandoned_verification_upload(${bucket}, ${key}) AS result`
  );

export const leadershipOptionsThroughRoutine = (actor: string) =>
  routine(sql`SELECT private.get_leadership_options(${actor}::uuid) AS result`);

/** Committee-level leadership when `team` is null (migration 0034). */
export const requestLeadershipThroughRoutine = (
  actor: string,
  committee: string,
  team: string | null,
  position: string
) =>
  routine(sql`
    SELECT private.request_leadership(
      ${actor}::uuid, ${committee}::uuid, ${team}::uuid, ${position}
    ) AS result
  `);

// ---------------------------------------------------------------------------
// Reviewers (Board Administration and Society Affairs; not Technical)
// ---------------------------------------------------------------------------
export const listSquThroughRoutine = (
  actor: string,
  filter: {
    state: string;
    query: string | null;
    from: Date | null;
    to: Date | null;
    offset: number;
  }
) =>
  routine(sql`
    SELECT private.list_squ_verifications(
      ${actor}::uuid, ${filter.state}, ${filter.query},
      ${timestamp(filter.from)}::timestamptz, ${timestamp(filter.to)}::timestamptz,
      ${filter.offset}::integer
    ) AS result
  `);

export const getSquThroughRoutine = (actor: string, request: string) =>
  routine(
    sql`SELECT private.get_squ_verification(${actor}::uuid, ${request}::uuid) AS result`
  );

export async function squDocumentThroughRoutine(
  actor: string,
  request: string
): Promise<{
  media_type: string;
  byte_size: number;
  sha256: string;
  content: Buffer | null;
  storage_bucket: string | null;
  storage_key: string | null;
} | null> {
  const rows = await db.execute<{
    media_type: string;
    byte_size: number;
    sha256: string;
    content: Buffer | null;
    storage_bucket: string | null;
    storage_key: string | null;
  }>(sql`
    SELECT * FROM private.get_squ_verification_document(${actor}::uuid, ${request}::uuid)
  `);
  return rows[0] ?? null;
}

export const decideSquThroughRoutine = (
  actor: string,
  request: string,
  revision: number,
  decision: "approve" | "reject",
  reason: string | null,
  note: string | null
) =>
  routine(sql`
    SELECT private.decide_squ_verification(
      ${actor}::uuid, ${request}::uuid, ${revision}::integer, ${decision}, ${reason}, ${note}
    ) AS result
  `);

export const revokeSquThroughRoutine = (
  actor: string,
  verification: string,
  reason: string,
  note: string | null
) =>
  routine(sql`
    SELECT private.revoke_squ_verification(
      ${actor}::uuid, ${verification}::uuid, ${reason}, ${note}
    ) AS result
  `);

export const purgeExpiredThroughRoutine = (actor: string, limit: number) =>
  routine(sql`
    SELECT private.purge_expired_verification_documents(${actor}::uuid, ${limit}::integer) AS result
  `);

export const listLeadershipThroughRoutine = (
  actor: string,
  filter: {
    status: string;
    committee: string | null;
    team: string | null;
    query: string | null;
    from: Date | null;
    to: Date | null;
    offset: number;
  }
) =>
  routine(sql`
    SELECT private.list_leadership_requests(
      ${actor}::uuid, ${filter.status}, ${filter.committee}::uuid, ${filter.team}::uuid,
      ${filter.query}, ${timestamp(filter.from)}::timestamptz,
      ${timestamp(filter.to)}::timestamptz, ${filter.offset}::integer
    ) AS result
  `);

export const leadershipFiltersThroughRoutine = (actor: string) =>
  routine(
    sql`SELECT private.leadership_filter_options(${actor}::uuid) AS result`
  );

export const getLeadershipThroughRoutine = (actor: string, request: string) =>
  routine(
    sql`SELECT private.get_leadership_request(${actor}::uuid, ${request}::uuid) AS result`
  );

export const decideLeadershipThroughRoutine = (
  actor: string,
  request: string,
  revision: number,
  decision: "approve" | "reject",
  reason: string | null,
  note: string | null
) =>
  routine(sql`
    SELECT private.decide_leadership_request(
      ${actor}::uuid, ${request}::uuid, ${revision}::integer, ${decision}, ${reason}, ${note}
    ) AS result
  `);

export const revokeAppointmentThroughRoutine = (
  actor: string,
  appointment: string,
  revision: number,
  reason: string,
  note: string | null
) =>
  routine(sql`
    SELECT private.revoke_leadership_appointment(
      ${actor}::uuid, ${appointment}::uuid, ${revision}::integer, ${reason}, ${note}
    ) AS result
  `);

export const settingsThroughRoutine = (actor: string) =>
  routine(
    sql`SELECT private.get_verification_settings(${actor}::uuid) AS result`
  );

export const setSettingsThroughRoutine = (
  actor: string,
  settings: {
    squSubmissionsPer30Days: number;
    documentRetentionDays: number | null;
    leadershipRequestsPer30Days: number;
    maxActiveAppointmentsPerMember: number | null;
  },
  confirmRetention: boolean
) =>
  routine(sql`
    SELECT private.set_verification_settings(
      ${actor}::uuid, ${settings.squSubmissionsPer30Days}::integer,
      ${settings.documentRetentionDays}::integer, ${settings.leadershipRequestsPer30Days}::integer,
      ${settings.maxActiveAppointmentsPerMember}::integer, ${confirmRetention}::boolean
    ) AS result
  `);

/** How many stored evidence files a retention period would make eligible for deletion now (0035). */
export const retentionImpactThroughRoutine = (actor: string, days: number) =>
  routine<CodeResult & { eligible?: number }>(sql`
    SELECT private.preview_retention_impact(${actor}::uuid, ${days}::integer) AS result
  `);

/** Holders of settings.verification open or close new leadership requests (0034, ADR 0027). */
export const setLeadershipRequestsOpenThroughRoutine = (
  actor: string,
  open: boolean
) =>
  routine(sql`
    SELECT private.set_leadership_requests_open(${actor}::uuid, ${open}::boolean) AS result
  `);

/** Holders per position at team level or committee level (0035). */
export const setPositionLimitThroughRoutine = (
  actor: string,
  position: string,
  level: "team" | "committee",
  max: number | null
) =>
  routine(sql`
    SELECT private.set_position_limit(${actor}::uuid, ${position}, ${level}::text, ${max}::integer) AS result
  `);

// ---------------------------------------------------------------------------
// Teams (Board Administration and Technical) and direct appointments
// (leadership reviewers: Board Administration and Society Affairs)
// ---------------------------------------------------------------------------
export const teamsThroughRoutine = (actor: string, committee: string) =>
  routine(
    sql`SELECT private.admin_list_committee_teams(${actor}::uuid, ${committee}::uuid) AS result`
  );

export type TeamText = {
  nameEn: string;
  nameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
};

export const createTeamThroughRoutine = (
  actor: string,
  committee: string,
  team: TeamText
) =>
  routine(sql`
    SELECT private.admin_create_team(
      ${actor}::uuid, ${committee}::uuid, ${team.nameEn}, ${team.nameAr},
      ${team.descriptionEn}, ${team.descriptionAr}
    ) AS result
  `);

export const updateTeamThroughRoutine = (
  actor: string,
  teamId: string,
  team: TeamText
) =>
  routine(sql`
    SELECT private.admin_update_team(
      ${actor}::uuid, ${teamId}::uuid, ${team.nameEn}, ${team.nameAr},
      ${team.descriptionEn}, ${team.descriptionAr}
    ) AS result
  `);

export const moveTeamThroughRoutine = (
  actor: string,
  team: string,
  committee: string
) =>
  routine(sql`
    SELECT private.admin_move_team(${actor}::uuid, ${team}::uuid, ${committee}::uuid) AS result
  `);

export const setTeamStatusThroughRoutine = (
  actor: string,
  team: string,
  status: "active" | "inactive" | "archived"
) =>
  routine(sql`
    SELECT private.admin_set_team_status(${actor}::uuid, ${team}::uuid, ${status}) AS result
  `);

export const deleteTeamThroughRoutine = (actor: string, team: string) =>
  routine(
    sql`SELECT private.admin_delete_team(${actor}::uuid, ${team}::uuid) AS result`
  );

/** Committee-level leadership when `team` is null (migration 0034). */
export const assignLeadershipThroughRoutine = (
  actor: string,
  member: string,
  committee: string,
  team: string | null,
  position: string,
  note: string | null
) =>
  routine(sql`
    SELECT private.assign_leadership(
      ${actor}::uuid, ${member}::uuid, ${committee}::uuid, ${team}::uuid, ${position}, ${note}
    ) AS result
  `);

export const updateAppointmentThroughRoutine = (
  actor: string,
  appointment: string,
  revision: number,
  position: string,
  note: string | null
) =>
  routine(sql`
    SELECT private.update_leadership_appointment(
      ${actor}::uuid, ${appointment}::uuid, ${revision}::integer, ${position}, ${note}
    ) AS result
  `);
