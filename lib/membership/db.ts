// Server-only access to the public membership routines (migrations 0025–0027
// and 0033). The runtime role has no table privileges; everything goes through
// these calls.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { MembershipOptions } from "./types";

type RoutineResult = {
  code: string;
  field?: string;
  applicationId?: string;
  status?: string;
  accountActivation?: string;
};

type ImmediateAccountRoutine = {
  code: string;
  userId?: string;
  email?: string;
  applicationId?: string;
  member?: boolean;
};

/** ADR 0030: what Core may do for this application's immediate account (CREATE or LINK). */
export async function beginImmediateAccountThroughRoutine(
  statusTokenHash: string
): Promise<ImmediateAccountRoutine> {
  const rows = await db.execute<{ result: ImmediateAccountRoutine }>(
    sql`SELECT private.begin_immediate_account(${statusTokenHash}) AS result`
  );
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

/** ADR 0030: links the account Core created and, if approved, writes the member record. */
export async function completeImmediateAccountThroughRoutine(
  statusTokenHash: string,
  userId: string
): Promise<ImmediateAccountRoutine> {
  const rows = await db.execute<{ result: ImmediateAccountRoutine }>(
    sql`SELECT private.complete_immediate_account(${statusTokenHash}, ${userId}::uuid) AS result`
  );
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

/**
 * The expanded application (migration 0033, ADR 0025): no student ID and no
 * document. The category decides which details the routine accepts.
 */
export async function submitThroughRoutine(input: {
  fullName: string;
  email: string;
  category: string;
  institutionId: string | null;
  institutionName: string | null;
  academicYear: number | null;
  discipline: string;
  interests: string[];
  consentVersion: string;
  statusTokenHash: string;
  ipAddress: string;
}): Promise<RoutineResult> {
  const interests = `{${input.interests.join(",")}}`;
  const rows = await db.execute<{ result: RoutineResult }>(sql`
    SELECT private.submit_membership_application_v2(
      ${input.fullName}, ${input.email}, ${input.category}, ${input.institutionId},
      ${input.institutionName}, ${input.academicYear}::integer, ${input.discipline},
      ${interests}::text[], ${input.consentVersion}, ${input.statusTokenHash},
      ${input.ipAddress}::inet
    ) AS result
  `);
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export async function optionsThroughRoutine(): Promise<{
  code: string;
  categories?: MembershipOptions["categories"];
  institutions?: MembershipOptions["institutions"];
  consentVersion?: string;
  approval?: string;
  accountActivation?: string;
}> {
  const rows = await db.execute<{ result: { code: string } }>(
    sql`SELECT private.get_membership_options() AS result`
  );
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export async function claimStorageDeletionsThroughRoutine(
  limit: number
): Promise<{ id: string; bucket: string; key: string }[]> {
  const rows = await db.execute<{
    deletion_id: string;
    bucket: string;
    object_key: string;
  }>(sql`
    SELECT * FROM private.claim_membership_storage_deletions(${limit}::integer)
  `);
  return rows.map((row) => ({
    id: row.deletion_id,
    bucket: row.bucket,
    key: row.object_key,
  }));
}

export async function completeStorageDeletionThroughRoutine(
  deletionId: string
): Promise<void> {
  await db.execute(sql`
    SELECT private.complete_membership_storage_deletion(${deletionId}::uuid)
  `);
}

// The signed-in applicant's own view (migration 0027). The user ID is the one
// Supabase Auth verified for this request, never a value from the request.
export async function ownMembershipThroughRoutine(userId: string): Promise<{
  code: string;
  member?: { status: string; since: string } | null;
  application?: {
    status: string;
    submittedAt: string;
    decidedAt: string | null;
    activated: boolean;
  } | null;
}> {
  const rows = await db.execute<{ result: { code: string } }>(sql`
    SELECT private.get_my_membership(${userId}::uuid) AS result
  `);
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export async function statusThroughRoutine(statusTokenHash: string): Promise<{
  code: string;
  status?: string;
  submittedAt?: string;
  decidedAt?: string | null;
  activated?: boolean;
}> {
  const rows = await db.execute<{ result: { code: string } }>(sql`
    SELECT private.get_membership_application_status(${statusTokenHash}) AS result
  `);
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}
