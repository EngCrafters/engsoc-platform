import { readFileSync } from "node:fs";
import postgres from "postgres";

const line = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((entry) => entry.startsWith("APP_RUNTIME_DATABASE_URL="));
if (!line)
  throw new Error("APP_RUNTIME_DATABASE_URL is missing from .env.local");

const connectionString = line
  .slice("APP_RUNTIME_DATABASE_URL=".length)
  .trim()
  .replace(/^"|"$/g, "");
const target = new URL(connectionString);
const directStaging = target.hostname === "db.wnrdgnmmcdedmilnzzsl.supabase.co";
const pooledStaging =
  target.hostname.endsWith(".pooler.supabase.com") &&
  target.username.endsWith(".wnrdgnmmcdedmilnzzsl");
if (!directStaging && !pooledStaging) {
  throw new Error("This role check is restricted to the UC-02 staging project");
}

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  const [identity] = await sql`SELECT current_user AS role`;
  if (identity.role !== "app_runtime") throw new Error("Runtime role mismatch");
  const [counts] = await sql`
    SELECT * FROM private.count_admin_events(
      '00000000-0000-4000-8000-000000000000'::uuid,
      NULL::uuid
    )
  `;
  if (counts.total_count !== 0) throw new Error("Unknown actor saw events");
  let directTableDenied = false;
  try {
    await sql`SELECT id FROM public.events LIMIT 1`;
  } catch (error) {
    directTableDenied = error.code === "42501";
  }
  if (!directTableDenied) throw new Error("Direct table read was not denied");
  console.log(
    JSON.stringify({
      role: identity.role,
      unknownActorCount: counts.total_count,
      directTableDenied,
    })
  );
} finally {
  await sql.end();
}
