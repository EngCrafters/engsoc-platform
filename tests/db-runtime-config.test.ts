import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIME_DATABASE_URL_MISSING,
  getDb,
  requireRuntimeDatabaseUrl,
  resetDbForTests,
} from "@/db";

/**
 * F-06: building the app must not require a runtime database credential.
 *
 * Next.js evaluates server modules during `next build` while collecting page
 * data. When the client was constructed at module scope, importing this module
 * threw without APP_RUNTIME_DATABASE_URL, so a clean build failed for routes
 * that never touch the database and Vercel Preview could not compile without a
 * fake URL. These tests pin both halves of the fix: importing is free, and the
 * first real use still fails closed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetDbForTests();
});

describe("runtime database configuration", () => {
  it("imports without a runtime URL", async () => {
    vi.stubEnv("APP_RUNTIME_DATABASE_URL", "");
    vi.resetModules();
    // The whole point: importing must not construct a client or throw.
    await expect(import("@/db")).resolves.toBeDefined();
  });

  it("still fails closed on the first real use", async () => {
    vi.stubEnv("APP_RUNTIME_DATABASE_URL", "");
    resetDbForTests();
    expect(() => getDb()).toThrow(RUNTIME_DATABASE_URL_MISSING);
  });

  it("fails through the proxy as well, not only through getDb", async () => {
    vi.stubEnv("APP_RUNTIME_DATABASE_URL", "");
    vi.resetModules();
    const fresh = await import("@/db");
    fresh.resetDbForTests();
    expect(() => fresh.db.execute).toThrow(RUNTIME_DATABASE_URL_MISSING);
  });

  it("never falls back to DATABASE_URL", () => {
    // A migration credential can do DDL and bypass the app_runtime grants.
    // Silently using it at runtime would defeat the whole security model.
    vi.stubEnv("APP_RUNTIME_DATABASE_URL", "");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://postgres:postgres@127.0.0.1:5432/postgres"
    );
    resetDbForTests();
    expect(() => requireRuntimeDatabaseUrl()).toThrow(
      RUNTIME_DATABASE_URL_MISSING
    );
    expect(() => getDb()).toThrow(RUNTIME_DATABASE_URL_MISSING);
  });

  it("reports the variable by name so the fix is obvious", () => {
    vi.stubEnv("APP_RUNTIME_DATABASE_URL", "");
    resetDbForTests();
    expect(() => getDb()).toThrow(/APP_RUNTIME_DATABASE_URL/);
    // and never echoes a credential value
    expect(RUNTIME_DATABASE_URL_MISSING).not.toMatch(/postgres:\/\//);
  });

  it("returns the configured URL when it is present", () => {
    vi.stubEnv(
      "APP_RUNTIME_DATABASE_URL",
      "postgres://app_runtime:pw@127.0.0.1:5432/uc02_test"
    );
    expect(requireRuntimeDatabaseUrl()).toBe(
      "postgres://app_runtime:pw@127.0.0.1:5432/uc02_test"
    );
  });
});
