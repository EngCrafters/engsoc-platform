// Server-only Drizzle client. Runtime application code must use the
// restricted `app_runtime` connection (APP_RUNTIME_DATABASE_URL) — there is
// no fallback to DATABASE_URL, which is a migration-only credential (see
// drizzle.config.ts) and must never be used by the running application.
// Never import this module into a client component.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// prepare: false — DATABASE_URL points at Supabase's transaction-mode
// pooler (port 6543). Named prepared statements don't survive a pooled
// connection being handed to a different backend session between queries,
// so they must stay unnamed. See the Supabase Postgres best-practices skill,
// "Use Prepared Statements Correctly with Pooling."
const runtimeDatabaseUrl = process.env.APP_RUNTIME_DATABASE_URL;

if (!runtimeDatabaseUrl) {
  throw new Error(
    "APP_RUNTIME_DATABASE_URL is required for runtime database access."
  );
}

// Every real target (Supabase, staging or main) is remote and must use TLS.
// The only exception is the disposable local Postgres container the
// isolated test suites (tests/db, tests/e2e) run against — it has no TLS
// listener at all, and it's never anything but 127.0.0.1/localhost.
const isLocalTestDatabase = ["127.0.0.1", "localhost"].includes(
  new URL(runtimeDatabaseUrl).hostname
);

const client = postgres(runtimeDatabaseUrl, {
  // Vercel functions are short-lived and this URL targets Supabase's
  // transaction pooler: cap each warm instance at one connection, do not
  // use prepared statements, and refuse an unencrypted connection to any
  // real (non-localhost) target.
  max: 1,
  prepare: false,
  ssl: isLocalTestDatabase ? false : "require",
});

export const db = drizzle(client, { schema });
