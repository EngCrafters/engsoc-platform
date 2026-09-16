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
const client = postgres(
  process.env.APP_RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL!,
  { prepare: false }
);

export const db = drizzle(client, { schema });
