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
 * script that wrote business rows was pointed at staging only by an explicit
 * CLI flag, while the checkout's implicit Supabase link resolved to
 * production. A comment cannot enforce that. This guard can, and these tests
 * prove the guard fails closed.
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
  const stagingConnection = `postgres://postgres.${STAGING_PROJECT_REF}@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
  const productionConnection = `postgres://postgres.${PRODUCTION_PROJECT_REF}@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;

  it("accepts an explicit staging target", () => {
    expect(
      assertOperatorScriptTarget(stagingConnection, STAGING_PROJECT_REF)
    ).toBe(STAGING_PROJECT_REF);
  });

  it("refuses an implicit target", () => {
    expect(() =>
      assertOperatorScriptTarget(stagingConnection, undefined)
    ).toThrow(/must name their target project ref explicitly/);
  });

  it("refuses the production ref even when it is named deliberately", () => {
    expect(() =>
      assertOperatorScriptTarget(productionConnection, PRODUCTION_PROJECT_REF)
    ).toThrow(
      /refusing to run an operator script against the production project/i
    );
  });

  it("refuses a connection that does not match the declared ref", () => {
    expect(() =>
      assertOperatorScriptTarget(productionConnection, STAGING_PROJECT_REF)
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
  const stagingConnection = `postgres://postgres.${STAGING_PROJECT_REF}@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
  const productionConnection = `postgres://postgres.${PRODUCTION_PROJECT_REF}@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;

  it("accepts an explicitly named production target for a read-only check", () => {
    expect(
      assertProductionProjectTarget(
        productionConnection,
        PRODUCTION_PROJECT_REF
      )
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("refuses to run a production check against staging", () => {
    expect(() =>
      assertProductionProjectTarget(stagingConnection, PRODUCTION_PROJECT_REF)
    ).toThrow(/restricted to the production project/);
  });

  it("refuses an unnamed target", () => {
    expect(() =>
      assertProductionProjectTarget(productionConnection, undefined)
    ).toThrow(/must name the production project ref explicitly/);
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
