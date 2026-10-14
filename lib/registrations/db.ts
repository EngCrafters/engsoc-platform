// Server-only implementation of the registration boundary. The app runtime
// role has no table DML grants; all writes go through the fixed private
// routine installed by the UC-02 security migration.

import { sql } from "drizzle-orm";
import { db } from "@/db";

export type RegistrationIntent = "register" | "join_waitlist";

type RoutineResult = { code: string };

export async function registerThroughRoutine(input: {
  eventId: string;
  attendeeName: string;
  attendeeEmail: string;
  /** Already canonical: the caller normalized it before reaching here. */
  attendeePhone: string;
  intent: RegistrationIntent;
  ipAddress: string;
}): Promise<RoutineResult> {
  // One statement, one routine, one round trip. The phone argument changed the
  // routine's signature, not the shape of this call: nothing was added around
  // it, and registration is still a single domain operation.
  const result = await db.execute<{ result: RoutineResult }>(sql`
    select private.register_for_event(
      ${input.eventId}::uuid,
      ${input.attendeeName},
      ${input.attendeeEmail},
      ${input.attendeePhone},
      ${input.intent},
      ${input.ipAddress}::inet
    ) as result
  `);
  return result[0]?.result ?? { code: "SERVER_ERROR" };
}
