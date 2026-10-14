import postgres from "postgres";
import {
  PRODUCTION_PROJECT_REF,
  assertProductionProjectTarget,
} from "./lib/supabase-target.mjs";

const connectionString = process.env.APP_RUNTIME_DATABASE_URL;
if (!connectionString) throw new Error("APP_RUNTIME_DATABASE_URL is required");

// READ-ONLY production verification. Targeting is asserted explicitly so a
// misconfigured environment cannot produce a meaningless pass against staging.
assertProductionProjectTarget(connectionString, PRODUCTION_PROJECT_REF);

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: "require",
});
try {
  const [identity] = await sql`SELECT current_user AS role`;
  if (identity.role !== "app_runtime") throw new Error("Runtime role mismatch");
  const [manager] = await sql`
    SELECT * FROM private.count_admin_events(
      'e1e17ce7-e96f-49c0-a39b-88cab5bfd55f'::uuid,
      'b314c2af-3df1-4be0-9b7b-e9be36a75a72'::uuid
    )
  `;
  const [unknown] = await sql`
    SELECT * FROM private.count_admin_events(
      '00000000-0000-4000-8000-000000000000'::uuid,
      NULL::uuid
    )
  `;
  if (manager.total_count !== 0 || unknown.total_count !== 0) {
    throw new Error("Unexpected production event scope");
  }
  let directTableDenied = false;
  try {
    await sql`SELECT id FROM public.events LIMIT 1`;
  } catch (error) {
    directTableDenied = error.code === "42501";
  }
  if (!directTableDenied) throw new Error("Direct table read was not denied");
  console.log(
    JSON.stringify({
      project: PRODUCTION_PROJECT_REF,
      role: identity.role,
      managerCount: manager.total_count,
      unknownActorCount: unknown.total_count,
      directTableDenied,
    })
  );
} finally {
  await sql.end();
}
