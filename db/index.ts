// Server-only Drizzle client. Import this in route handlers and server
// actions to query the database with full type safety from db/schema.ts.
// Don't import this into a client component, DATABASE_URL is a server-only
// secret.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// prepare: false — DATABASE_URL points at Supabase's transaction-mode
// pooler (port 6543). Named prepared statements don't survive a pooled
// connection being handed to a different backend session between queries,
// so they must stay unnamed. See the Supabase Postgres best-practices skill,
// "Use Prepared Statements Correctly with Pooling."
const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle(client, { schema });
