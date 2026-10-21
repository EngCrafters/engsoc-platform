import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, close } from "./helpers";

function gate(url: string) {
  return spawnSync(process.execPath, ["scripts/check-schema-compat.mjs"], {
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      NODE_ENV: "test",
      VERCEL: "1",
      VERCEL_ENV: "production",
      APP_RUNTIME_DATABASE_URL: url,
    },
    encoding: "utf8",
  });
}

describe("release gate against a real database (ADR 0022)", () => {
  const admin = adminDb();
  afterAll(() => close(admin));

  it("passes the restricted runtime role at the current schema", () => {
    const result = gate(process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL!);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("compatible");
  });

  it("refuses a connection that bypasses row-level security, without printing it", () => {
    const url = process.env.TEST_DATABASE_URL!;
    const result = gate(url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bypasses row-level security");
    expect(result.stderr + result.stdout).not.toContain(url);
  });

  it("refuses a database older than the code", async () => {
    await admin.unsafe(
      "CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 29 $$"
    );
    try {
      const result = gate(process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL!);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("this code needs 30");
    } finally {
      await admin.unsafe(
        "CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$"
      );
    }
  });
});
