import { randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";

export type RoutineResult = {
  code: string;
  registrationId?: string;
  eventId?: string;
  revision?: number;
};

export function adminDb(): Sql {
  return postgres(required("TEST_DATABASE_URL"), { max: 4, prepare: false });
}

export function runtimeDb(): Sql {
  return postgres(required("UC02_TEST_APP_RUNTIME_DATABASE_URL"), {
    max: 4,
    prepare: false,
  });
}

export function maintenanceDb(): Sql {
  return postgres(required("UC02_TEST_APP_MAINTENANCE_DATABASE_URL"), {
    max: 4,
    prepare: false,
  });
}

function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} was not provisioned by the UC-02 test harness.`);
  return value;
}

export async function close(...connections: Sql[]) {
  await Promise.all(
    connections.map((connection) => connection.end({ timeout: 5 }))
  );
}

export async function createFixture(
  sql: Sql,
  options: {
    capacity?: number | null;
    status?: "draft" | "published" | "full";
    eventDate?: Date;
  } = {}
) {
  const committeeId = randomUUID();
  const otherCommitteeId = randomUUID();
  const managerId = randomUUID();
  const reviewerId = randomUUID();
  const otherManagerId = randomUUID();
  const eventId = randomUUID();
  const eventDate = options.eventDate ?? new Date(Date.now() + 86_400_000);
  const capacity = options.capacity ?? null;
  const status = options.status ?? "draft";

  await sql`INSERT INTO auth.users (id) VALUES (${managerId}), (${reviewerId}), (${otherManagerId})`;
  await sql`
    INSERT INTO public.committees (id, name)
    VALUES (${committeeId}, ${`Committee ${committeeId}`}), (${otherCommitteeId}, ${`Committee ${otherCommitteeId}`})
  `;
  await sql`
    INSERT INTO public.committee_managers (user_id, committee_id, granted_by)
    VALUES
      (${managerId}, ${committeeId}, ${managerId}),
      (${reviewerId}, ${committeeId}, ${managerId}),
      (${otherManagerId}, ${otherCommitteeId}, ${otherManagerId})
  `;
  await sql`
    INSERT INTO public.events (id, title, description, event_date, committee_id, status, capacity)
    VALUES (${eventId}, 'UC-02 test event', 'A complete test event description.', ${eventDate}, ${committeeId}, ${status}, ${capacity})
  `;

  return {
    committeeId,
    otherCommitteeId,
    managerId,
    reviewerId,
    otherManagerId,
    eventId,
  };
}

export async function callRoutine(
  sql: Sql | TransactionSql,
  name:
    | "register_for_event"
    | "flag_review"
    | "approve_event"
    | "publish_event"
    | "hold_event_full"
    | "archive_event"
    | "restore_event"
    | "promote_waitlist"
    | "create_event"
    | "edit_event"
    | "list_admin_events",
  values: (string | number | boolean | null)[]
): Promise<RoutineResult> {
  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.unsafe(
    `SELECT private.${name}(${placeholders}) AS result`,
    values
  );
  return rows[0].result as RoutineResult;
}

export async function registration(
  sql: Sql | TransactionSql,
  eventId: string,
  email: string,
  intent: "register" | "join_waitlist" = "register",
  ip = "198.51.100.10"
) {
  return callRoutine(sql, "register_for_event", [
    eventId,
    "Test Attendee",
    email,
    intent,
    ip,
  ]);
}

export async function asAuthenticated<T>(
  sql: Sql,
  userId: string,
  callback: () => Promise<T>
) {
  await sql.unsafe("SELECT set_config('request.jwt.claim.sub', $1, false)", [
    userId,
  ]);
  await sql.unsafe("SET ROLE authenticated");
  try {
    return await callback();
  } finally {
    await sql.unsafe("RESET ROLE");
    await sql.unsafe("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}
