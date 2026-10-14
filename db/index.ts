// Server-only Drizzle client. Runtime application code must use the
// restricted `app_runtime` connection (APP_RUNTIME_DATABASE_URL) — there is
// no fallback to DATABASE_URL, which is a migration-only credential (see
// drizzle.config.ts) and must never be used by the running application.
// Never import this module into a client component.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof createDatabase>;

/**
 * Read and validate the runtime credential.
 *
 * The single place that decides whether this process may talk to the
 * database. There is deliberately no fallback to DATABASE_URL.
 */
function requireRuntimeDatabaseUrl(): string {
  const url = process.env.APP_RUNTIME_DATABASE_URL;
  if (!url) {
    throw new Error(
      "APP_RUNTIME_DATABASE_URL is required for runtime database access."
    );
  }
  return url;
}

function createDatabase() {
  const url = requireRuntimeDatabaseUrl();

  // Every real target (Supabase, staging or main) is remote and must use TLS.
  // The only exception is the disposable local Postgres container the
  // isolated test suites (tests/db, tests/e2e) run against — it has no TLS
  // listener at all, and it's never anything but 127.0.0.1/localhost.
  const isLocalTestDatabase = ["127.0.0.1", "localhost"].includes(
    new URL(url).hostname
  );

  const client = postgres(url, {
    // Vercel functions are short-lived and this URL targets Supabase's
    // transaction pooler: cap each warm instance at one connection, do not
    // use prepared statements, and refuse an unencrypted connection to any
    // real (non-localhost) target.
    max: 1,
    prepare: false,
    ssl: isLocalTestDatabase ? false : "require",
  });

  return drizzle(client, { schema });
}

let database: Database | undefined;

function getDatabase(): Database {
  database ??= createDatabase();
  return database;
}

/**
 * The runtime database handle.
 *
 * Construction is deferred to first use rather than happening at module
 * evaluation. Next.js evaluates route modules while collecting page data
 * during `next build`, so an eager throw here made the production build
 * require a live runtime credential the build never uses. Deferring keeps the
 * build hermetic without weakening the runtime guarantee: the credential is
 * still required, still validated, and still has no fallback — the process
 * fails on first query instead of at import.
 *
 * `instrumentation.ts` restores fail-fast behaviour where it matters, at
 * server startup, so a misconfigured deployment cannot serve traffic at all.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = getDatabase();
    const value = Reflect.get(instance as object, property, receiver);
    // Bind methods so `this` stays the real Drizzle instance.
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/**
 * Fail fast when the runtime credential is missing.
 *
 * Called from `instrumentation.ts` at server bootstrap — the earliest point a
 * real deployment can be checked without making the build depend on a runtime
 * secret.
 */
export function assertRuntimeDatabaseConfiguration(): void {
  requireRuntimeDatabaseUrl();
}
