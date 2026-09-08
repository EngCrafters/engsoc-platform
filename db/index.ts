// Server-only Drizzle client. Import this in route handlers and server
// actions to query the database with full type safety from db/schema.ts.
// Don't import this into a client component, DATABASE_URL is a server-only
// secret.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });
