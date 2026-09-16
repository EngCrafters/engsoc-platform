// Server-only Drizzle client. Runtime application code must use the
// restricted `app_runtime` connection. DATABASE_URL remains a local
// development/migration fallback until every environment has the dedicated
// credential configured. Never import this module into a client component.

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

const client = postgres(runtimeDatabaseUrl, {
  // Vercel functions are short-lived and this URL targets Supabase's
  // transaction pooler: cap each warm instance at one connection, do not
  // use prepared statements, and refuse an unencrypted connection.
  max: 1,
  prepare: false,
  ssl: "require",
});

export const db = drizzle(client, { schema });
