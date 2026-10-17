// Server-only Drizzle client.
//
// Runtime application code must use the restricted `app_runtime` connection
// (APP_RUNTIME_DATABASE_URL) — there is no fallback to DATABASE_URL, which is a
// migration-only credential (see drizzle.config.ts) and must never be used by
// the running application.
//
// INITIALIZATION IS LAZY ON PURPOSE (F-06)
// ----------------------------------------
// Building a Postgres client at module scope means that merely *importing* this
// module requires a real runtime credential. Next.js evaluates server modules
// while collecting page data during `next build`, so a build then failed with
// "APP_RUNTIME_DATABASE_URL is required" even for routes that never touch the
// database — and Vercel Preview, which intentionally has no runtime database,
// could not compile at all without a fake URL.
//
// The export below is therefore a proxy: importing this module does nothing but
// declare it. The credential is checked, and the connection is opened, on the
// first genuine database operation. Fail-closed behaviour is preserved — the
// failure just happens where it belongs, at the call, not at import time.
//
// Never import this module into a client component.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const RUNTIME_DATABASE_URL_MISSING =
  "APP_RUNTIME_DATABASE_URL is required for runtime database access.";

/**
 * Read the runtime credential. Deliberately does NOT fall back to
 * DATABASE_URL: that credential can perform DDL and bypass the narrow
 * app_runtime grants, so using it at runtime would silently defeat the entire
 * security model described in db/README.md.
 */
export function requireRuntimeDatabaseUrl(): string {
  const url = process.env.APP_RUNTIME_DATABASE_URL;
  if (!url) throw new Error(RUNTIME_DATABASE_URL_MISSING);
  return url;
}

function createRuntimeDb() {
  const runtimeDatabaseUrl = requireRuntimeDatabaseUrl();

  // Every real target (Supabase, staging or main) is remote and must use TLS.
  // The only exception is the disposable local Postgres container the isolated
  // test suites (tests/db, tests/e2e) run against — it has no TLS listener at
  // all, and it is never anything but 127.0.0.1/localhost.
  const isLocalTestDatabase = ["127.0.0.1", "localhost"].includes(
    new URL(runtimeDatabaseUrl).hostname
  );

  // prepare: false — the runtime URL targets Supabase's transaction-mode pooler
  // (port 6543). Named prepared statements do not survive a pooled connection
  // being handed to a different backend session between queries, so they must
  // stay unnamed.
  //
  // Vercel functions are short-lived, so cap each warm instance at one
  // connection and refuse an unencrypted connection to any non-local target.
  const client = postgres(runtimeDatabaseUrl, {
    max: 1,
    prepare: false,
    ssl: isLocalTestDatabase ? false : "require",
  });

  return drizzle(client, { schema });
}

type RuntimeDb = ReturnType<typeof createRuntimeDb>;

let cached: RuntimeDb | undefined;

/** The initialised client, created on first use. */
export function getDb(): RuntimeDb {
  cached ??= createRuntimeDb();
  return cached;
}

/** Test seam: forget the cached client so lazy initialization can be re-tested. */
export function resetDbForTests(): void {
  cached = undefined;
}

export const db: RuntimeDb = new Proxy({} as RuntimeDb, {
  get(_target, property) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[property];
    // Bind functions to the real client so query builders keep their identity.
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, property) {
    return property in (getDb() as unknown as object);
  },
  ownKeys() {
    return Reflect.ownKeys(getDb() as unknown as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(
      getDb() as unknown as object,
      property
    );
  },
});
