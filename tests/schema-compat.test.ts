import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import journal from "@/db/migrations/meta/_journal.json";

const state = vi.hoisted(() => ({ version: vi.fn() }));
vi.mock("@/lib/db/schema-version", () => ({
  REQUIRED_SCHEMA_VERSION: 30,
  databaseSchemaVersion: state.version,
}));
const { GET } = await import("@/app/v1/health/route");

/** Runs the release gate with exactly the given environment (plus PATH). */
function gate(env: Record<string, string>) {
  return spawnSync(process.execPath, ["scripts/check-schema-compat.mjs"], {
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      NODE_ENV: "test",
      ...env,
    },
    encoding: "utf8",
  });
}

describe("release schema compatibility (ADR 0022)", () => {
  it("makes every migration from 0030 on declare its own schema version", () => {
    const later = journal.entries.filter((entry) => entry.idx >= 30);
    expect(later.length).toBeGreaterThan(0);
    for (const entry of later) {
      const text = readFileSync(`db/migrations/${entry.tag}.sql`, "utf8");
      expect(text).toMatch(
        new RegExp(
          `FUNCTION private\\.core_schema_version\\(\\)[\\s\\S]{0,80}SELECT ${entry.idx}\\b`
        )
      );
    }
  });

  it("skips outside Vercel, and fails only Vercel production when it cannot verify", () => {
    const local = gate({});
    expect(local.status).toBe(0);
    expect(local.stdout).toContain("skipped outside Vercel");
    const production = gate({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain("APP_RUNTIME_DATABASE_URL is not set");
    const preview = gate({ VERCEL: "1", VERCEL_ENV: "preview" });
    expect(preview.status).toBe(0);
    const unreachable = gate({
      VERCEL: "1",
      VERCEL_ENV: "production",
      APP_RUNTIME_DATABASE_URL:
        "postgres://app_runtime:secret-password@127.0.0.1:9/none",
    });
    expect(unreachable.status).toBe(1);
    expect(unreachable.stderr).toContain("database unreachable");
    expect(unreachable.stderr + unreachable.stdout).not.toContain(
      "secret-password"
    );
  });

  it("reports health without disclosing versions", async () => {
    const request = new Request("https://api.essqu.com/v1/health");
    state.version.mockResolvedValueOnce(30);
    const ok = await GET(request);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { status: "ok" } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    state.version.mockResolvedValueOnce(29);
    const behind = await GET(request);
    expect(behind.status).toBe(503);
    const text = await behind.text();
    expect(text).toContain("schema-behind");
    expect(text).not.toMatch(/29|30/);
    state.version.mockRejectedValueOnce(
      Object.assign(new Error("password authentication failed"), {
        code: "28P01",
      })
    );
    const down = await GET(request);
    expect(down.status).toBe(503);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("password");
    errors.mockRestore();
  });
});
