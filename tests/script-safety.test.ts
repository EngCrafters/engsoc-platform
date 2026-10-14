import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  assertNoImplicitLinkedTarget,
  assertOperatorScriptTarget,
  assertProductionProjectTarget,
  projectRefFromConnectionString,
} from "../scripts/lib/supabase-target.mjs";
import {
  assertCliMigrationScope,
  assertCliMigrationTarget,
  isMigrationMutatingCommand,
  resolveCliTargetRef,
} from "../scripts/lib/supabase-cli-target.mjs";

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

/**
 * The Supabase CLI half of the same hazard.
 *
 * supabase-target.mjs guards Node scripts that pass a connection string. It
 * does not touch the CLI, which reads supabase/.temp/project-ref. In this
 * checkout that file holds the production ref, and the CLI has no local
 * migration set at all, so a push has no defined scope AND a production target.
 * These tests pin both refusals.
 */

describe("isMigrationMutatingCommand", () => {
  it.each([
    [["db", "push"]],
    [["db", "reset"]],
    [["db", "remote", "commit"]],
    [["migration", "up"]],
    [["migration", "down"]],
    [["migration", "repair"]],
  ])("recognises %j as mutating", (args) => {
    expect(isMigrationMutatingCommand(args)).toBe(true);
  });

  it.each([
    [["migration", "list"]],
    [["db", "dump"]],
    [["db", "pull"]],
    [["projects", "list"]],
  ])("treats %j as non-mutating", (args) => {
    expect(isMigrationMutatingCommand(args)).toBe(false);
  });

  it("lets a dry run through, so inspecting scope stays the easy path", () => {
    expect(isMigrationMutatingCommand(["db", "push", "--dry-run"])).toBe(false);
  });
});

describe("resolveCliTargetRef", () => {
  it("prefers an explicit --project-ref over the stored link", () => {
    expect(
      resolveCliTargetRef({
        args: ["db", "push", "--project-ref", STAGING_PROJECT_REF],
        linkedRef: PRODUCTION_PROJECT_REF,
      })
    ).toBe(STAGING_PROJECT_REF);
  });

  it("falls back to the linked ref when no flag is given", () => {
    expect(
      resolveCliTargetRef({
        args: ["db", "push"],
        linkedRef: PRODUCTION_PROJECT_REF,
      })
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("returns null when neither is available", () => {
    expect(
      resolveCliTargetRef({ args: ["db", "push"], linkedRef: null })
    ).toBeNull();
  });
});

describe("assertCliMigrationTarget", () => {
  it("refuses db push when the checkout is linked to production", () => {
    expect(() =>
      assertCliMigrationTarget({
        args: ["db", "push"],
        linkedRef: PRODUCTION_PROJECT_REF,
      })
    ).toThrow(/against the production project/);
  });

  it("refuses db reset and migration repair against production too", () => {
    for (const args of [
      ["db", "reset"],
      ["migration", "repair"],
      ["db", "remote", "commit"],
    ]) {
      expect(() =>
        assertCliMigrationTarget({ args, linkedRef: PRODUCTION_PROJECT_REF })
      ).toThrow(/against the production project/);
    }
  });

  it("refuses even when production is named explicitly through the flag", () => {
    expect(() =>
      assertCliMigrationTarget({
        args: ["db", "push", "--project-ref", PRODUCTION_PROJECT_REF],
        linkedRef: null,
      })
    ).toThrow(/against the production project/);
  });

  it("refuses an undeterminable target rather than guessing", () => {
    expect(() =>
      assertCliMigrationTarget({ args: ["db", "push"], linkedRef: null })
    ).toThrow(/Cannot determine which project/);
  });

  it("allows a mutating command aimed explicitly at staging", () => {
    expect(
      assertCliMigrationTarget({
        args: ["db", "push", "--project-ref", STAGING_PROJECT_REF],
        linkedRef: PRODUCTION_PROJECT_REF,
      })
    ).toEqual({ mutating: true, ref: STAGING_PROJECT_REF });
  });

  it("does not interfere with read-only commands", () => {
    expect(
      assertCliMigrationTarget({
        args: ["migration", "list", "--linked"],
        linkedRef: PRODUCTION_PROJECT_REF,
      })
    ).toEqual({ mutating: false, ref: PRODUCTION_PROJECT_REF });
  });

  it("permits production only behind the explicit acknowledgement", () => {
    expect(
      assertCliMigrationTarget({
        args: ["db", "push"],
        linkedRef: PRODUCTION_PROJECT_REF,
        allowProduction: true,
      })
    ).toEqual({ mutating: true, ref: PRODUCTION_PROJECT_REF });
  });
});

describe("assertCliMigrationScope", () => {
  it("refuses a push when the CLI has no local migration set", () => {
    // This is the assumption that makes the shortcut tempting and wrong: with
    // no local migration set, a push cannot be "just the one new file".
    expect(() =>
      assertCliMigrationScope({
        args: ["db", "push"],
        hasLocalMigrationSet: false,
      })
    ).toThrow(/no local migration set/);
  });

  it("allows a read-only command with no local migration set", () => {
    expect(
      assertCliMigrationScope({
        args: ["migration", "list"],
        hasLocalMigrationSet: false,
      })
    ).toBe(true);
  });

  it("allows a mutating command when a local migration set exists", () => {
    expect(
      assertCliMigrationScope({
        args: ["db", "push"],
        hasLocalMigrationSet: true,
      })
    ).toBe(true);
  });
});
