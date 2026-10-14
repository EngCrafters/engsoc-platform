#!/usr/bin/env node
/**
 * Preflight for anyone about to run a Supabase CLI migration command.
 *
 * Run this before `supabase db push`, `db reset`, `migration repair` or any
 * other command that mutates a remote database or its migration history.
 *
 * Exit 0 means the checkout is not silently pointed at production.
 * Exit 1 means it is, and the command you were about to run would have hit the
 * live database.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from "./lib/supabase-target.mjs";
import {
  assertCliMigrationScope,
  assertCliMigrationTarget,
  isMigrationMutatingCommand,
  resolveCliTargetRef,
} from "./lib/supabase-cli-target.mjs";

const args = process.argv.slice(2);
const allowProduction = args.includes("--allow-production");
const cliArgs = args.filter((arg) => arg !== "--allow-production");

function knownRef(ref) {
  if (ref === PRODUCTION_PROJECT_REF) return "PRODUCTION";
  if (ref === STAGING_PROJECT_REF) return "staging";
  return "UNKNOWN";
}

const linkFile = join(process.cwd(), "supabase", ".temp", "project-ref");
const linkedRef = existsSync(linkFile)
  ? readFileSync(linkFile, "utf8").trim()
  : null;

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const hasLocalMigrationSet =
  existsSync(migrationsDir) && readdirSync(migrationsDir).length > 0;

const target = resolveCliTargetRef({ args: cliArgs, linkedRef });
const mutating = isMigrationMutatingCommand(cliArgs);

console.log(
  `supabase link        : ${linkedRef ?? "(none)"} ${linkedRef ? `[${knownRef(linkedRef)}]` : ""}`
);
console.log(
  `CLI local migrations : ${hasLocalMigrationSet ? "present" : "absent"}`
);
if (mutating) {
  console.log(
    `command under test   : ${cliArgs.join(" ")} -> ${target ?? "(unknown)"}`
  );
}

let failed = false;
try {
  assertCliMigrationTarget({ args: cliArgs, linkedRef, allowProduction });
  assertCliMigrationScope({ args: cliArgs, hasLocalMigrationSet });
} catch (error) {
  failed = true;
  console.error(`\nREFUSED: ${error.message}`);
}

if (!failed && linkedRef === PRODUCTION_PROJECT_REF) {
  console.log(
    "\nThis checkout is linked to PRODUCTION. Any Supabase CLI command that resolves its target implicitly will act on the live database. The repository's migrations are applied through the documented route; see db/README.md."
  );
}

process.exit(failed ? 1 : 0);
