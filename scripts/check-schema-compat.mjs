// Release gate (ADR 0022), run before `next build`. On Vercel it refuses to ship
// code that needs a newer database than the one configured, or a runtime
// connection that bypasses row-level security (it must be the restricted
// app_runtime role). Production builds fail; preview builds only warn.
// Outside Vercel (local development, CI) it does nothing.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const journal = JSON.parse(
  readFileSync(
    new URL("../db/migrations/meta/_journal.json", import.meta.url),
    "utf8"
  )
);
const required = Math.max(...journal.entries.map((entry) => entry.idx));

if (process.env.VERCEL !== "1") {
  console.log(
    `schema check: skipped outside Vercel (this code needs migration ${required})`
  );
  process.exit(0);
}

const production = process.env.VERCEL_ENV === "production";
function stop(message) {
  console.error(`schema check: ${message}`);
  // Preview deployments warn so work in progress can still be inspected.
  process.exit(production ? 1 : 0);
}

const url = process.env.APP_RUNTIME_DATABASE_URL;
if (!url) stop("APP_RUNTIME_DATABASE_URL is not set");

const sql = postgres(url, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});
let role;
let actual = 0;
try {
  [role] = await sql`
    SELECT current_user AS name, rolsuper OR rolbypassrls AS privileged
    FROM pg_roles WHERE rolname = current_user`;
  const [probe] = await sql`
    SELECT to_regprocedure('private.core_schema_version()') IS NOT NULL AS present`;
  if (probe.present)
    actual = (await sql`SELECT private.core_schema_version() AS version`)[0]
      .version;
} catch (error) {
  // Never print the URL or the driver message; the error class is enough.
  stop(`database unreachable (${error?.code ?? error?.name ?? "error"})`);
} finally {
  await sql.end({ timeout: 5 });
}

if (role.privileged)
  stop(
    `the runtime connects as "${role.name}", which bypasses row-level security; use app_runtime`
  );
if (actual < required)
  stop(
    `the database is at migration ${actual || "0029 or older"}, this code needs ${required}; apply the migrations first`
  );
if (role.name !== "app_runtime")
  console.warn(
    `schema check: runtime role is "${role.name}", expected app_runtime`
  );
console.log(
  `schema check: database at ${actual}, code needs ${required}: compatible`
);
