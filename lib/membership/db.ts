// Server-only access to the public membership routines (migrations 0025 and
// 0026). The runtime role has no table privileges; everything goes through
// these calls.

import { sql } from "drizzle-orm";
import { db } from "@/db";

type RoutineResult = { code: string; field?: string; applicationId?: string };

export async function submitThroughRoutine(input: {
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  discipline: string;
  interests: string[];
  consentVersion: string;
  statusTokenHash: string;
  mediaType: string;
  sha256: string;
  content: Buffer;
  ipAddress: string;
}): Promise<RoutineResult> {
  const interests = `{${input.interests.join(",")}}`;
  const rows = await db.execute<{ result: RoutineResult }>(sql`
    SELECT private.submit_membership_application(
      ${input.fullName}, ${input.email}, ${input.universityId},
      ${input.academicYear}::integer, ${input.discipline}, ${interests}::text[],
      ${input.consentVersion}, ${input.statusTokenHash}, ${input.mediaType},
      ${input.sha256}, ${input.content}::bytea, ${input.ipAddress}::inet
    ) AS result
  `);
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

// The Storage path (migration 0026): begin, upload in Core, then submit the reference.

export async function beginSubmissionThroughRoutine(input: {
  email: string;
  universityId: string;
  ipAddress: string;
}): Promise<RoutineResult> {
  const rows = await db.execute<{ result: RoutineResult }>(sql`
    SELECT private.begin_membership_submission(
      ${input.email}, ${input.universityId}, ${input.ipAddress}::inet
    ) AS result
  `);
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export async function submitStoredThroughRoutine(input: {
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  discipline: string;
  interests: string[];
  consentVersion: string;
  statusTokenHash: string;
  mediaType: string;
  sha256: string;
  byteSize: number;
  storageBucket: string;
  storageKey: string;
  ipAddress: string;
}): Promise<RoutineResult> {
  const interests = `{${input.interests.join(",")}}`;
  const rows = await db.execute<{ result: RoutineResult }>(sql`
    SELECT private.submit_stored_membership_application(
      ${input.fullName}, ${input.email}, ${input.universityId},
      ${input.academicYear}::integer, ${input.discipline}, ${interests}::text[],
      ${input.consentVersion}, ${input.statusTokenHash}, ${input.mediaType},
      ${input.sha256}, ${input.byteSize}::integer, ${input.storageBucket},
      ${input.storageKey}, ${input.ipAddress}::inet
    ) AS result
  `);
  return rows[0]?.result ?? { code: "SERVER_ERROR" };
}

export async function queueAbandonedUploadThroughRoutine(
  storageBucket: string,
  storageKey: string
): Promise<string> {
  const rows = await db.execute<{ result: { code: string } }>(sql`
    SELECT private.queue_abandoned_membership_upload(${storageBucket}, ${storageKey}) AS result
  `);
  return rows[0]?.result?.code ?? "SERVER_ERROR";
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
