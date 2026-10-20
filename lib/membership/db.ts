// Server-only access to the public membership routines (migration 0025). The
// runtime role has no table privileges; everything goes through these calls.

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
