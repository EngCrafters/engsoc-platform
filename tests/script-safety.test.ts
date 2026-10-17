import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  assertNoImplicitLinkedTarget,
  assertOperatorScriptTarget,
  assertProductionProjectTarget,
  projectRefFromConnectionString,
} from "../scripts/lib/supabase-target.mjs";

/**
 * These tests exist because of a real hazard found in the audit: an operator
 * script that wrote business rows resolved its database target through the
 * Supabase CLI, while the checkout's implicit link pointed at production.
 * A comment cannot enforce that. This guard can, and these tests prove the
 * guard fails closed.
 */

describe("projectRefFromConnectionString", () => {
  it("reads the ref from a direct Supabase host", () => {
    expect(
      projectRefFromConnectionString(
        `postgres://postgres.${STAGING_PROJECT_REF}@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`
      )
    ).toBe(STAGING_PROJECT_REF);
  });

  it("reads the ref from a pooled Supabase host", () => {
    expect(
      projectRefFromConnectionString(
        `postgres://postgres.${PRODUCTION_PROJECT_REF}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
      )
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("returns null for a non-Supabase host", () => {
    expect(
      projectRefFromConnectionString(
        "postgres://postgres:postgres@127.0.0.1:5432/uc02_test"
      )
    ).toBeNull();
  });

  it("returns null for a malformed connection string", () => {
    expect(projectRefFromConnectionString("not a url")).toBeNull();
  });
});

describe("assertOperatorScriptTarget", () => {
  const staging = `postgres://postgres.${STAGING_PROJECT_REF}@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
  const production = `postgres://postgres.${PRODUCTION_PROJECT_REF}@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;

  it("accepts an explicit staging target", () => {
    expect(assertOperatorScriptTarget(staging, STAGING_PROJECT_REF)).toBe(
      STAGING_PROJECT_REF
    );
  });

  it("refuses an implicit target", () => {
    expect(() => assertOperatorScriptTarget(staging, undefined)).toThrow(
      /must name their target project ref explicitly/
    );
  });

  it("refuses the production ref even when it is named deliberately", () => {
    expect(() =>
      assertOperatorScriptTarget(production, PRODUCTION_PROJECT_REF)
    ).toThrow(
      /refusing to run an operator script against the production project/i
    );
  });

  it("refuses a connection that does not match the declared ref", () => {
    expect(() =>
      assertOperatorScriptTarget(production, STAGING_PROJECT_REF)
    ).toThrow(/refusing to continue/);
  });

  it("refuses a connection whose ref cannot be determined", () => {
    expect(() =>
      assertOperatorScriptTarget(
        "postgres://postgres:postgres@127.0.0.1:5432/uc02_test",
        STAGING_PROJECT_REF
      )
    ).toThrow(/does not identify a Supabase project ref/);
  });
});

describe("assertProductionProjectTarget", () => {
  const staging = `postgres://postgres.${STAGING_PROJECT_REF}@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
  const production = `postgres://postgres.${PRODUCTION_PROJECT_REF}@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;

  it("accepts an explicitly named production target for a read-only check", () => {
    expect(
      assertProductionProjectTarget(production, PRODUCTION_PROJECT_REF)
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("refuses to run a production check against staging", () => {
    expect(() =>
      assertProductionProjectTarget(staging, PRODUCTION_PROJECT_REF)
    ).toThrow(/restricted to the production project/);
  });

  it("refuses an unnamed target", () => {
    expect(() => assertProductionProjectTarget(production, undefined)).toThrow(
      /must name the production project ref explicitly/
    );
  });
});

describe("assertNoImplicitLinkedTarget", () => {
  it("refuses --linked, which resolves through supabase/.temp/project-ref", () => {
    expect(() =>
      assertNoImplicitLinkedTarget(["db", "query", "--linked"])
    ).toThrow(/--linked resolves/);
  });

  it("accepts an explicit --project-ref invocation", () => {
    expect(
      assertNoImplicitLinkedTarget([
        "db",
        "query",
        "--project-ref",
        STAGING_PROJECT_REF,
      ])
    ).toBe(true);
  });
});

/**
 * Regression proof for F-01.
 *
 * The M7 smoke script was write-capable and resolved its target through the
 * Supabase CLI while the checkout's link pointed at production. It was removed
 * rather than repaired because nothing referenced it. These tests make an
 * accidental reintroduction fail loudly, so the hazard cannot quietly return.
 */
describe("F-01: the write-capable M7 smoke script stays removed", () => {
  const repoRoot = join(import.meta.dirname, "..");

  it("no longer exists on disk", () => {
    expect(
      existsSync(join(repoRoot, "scripts", "m7-staging-browser-smoke.ts"))
    ).toBe(false);
  });

  it("is not referenced by any package script", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const scripts = Object.values(manifest.scripts ?? {}).join(" ");
    expect(scripts).not.toMatch(/m7-staging-browser-smoke/);
  });
});
