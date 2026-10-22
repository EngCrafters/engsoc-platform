import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import journal from "@/db/migrations/meta/_journal.json";

/**
 * Release compatibility (ADR 0022). The code needs every migration in its own
 * journal; from 0030 on, each migration sets `private.core_schema_version()` to
 * its number, so a database older than the code is detected instead of failing
 * later as missing routines.
 */
export const REQUIRED_SCHEMA_VERSION = Math.max(
  ...journal.entries.map((entry) => entry.idx)
);

/** The database's schema version; 0 before 0030 introduced the marker. */
export async function databaseSchemaVersion(): Promise<number> {
  const [probe] = await db.execute<{ present: boolean }>(
    sql`SELECT to_regprocedure('private.core_schema_version()') IS NOT NULL AS present`
  );
  if (!probe?.present) return 0;
  const [row] = await db.execute<{ version: number }>(
    sql`SELECT private.core_schema_version() AS version`
  );
  return Number(row?.version ?? 0);
}
