/**
 * Target guard for the Supabase CLI itself.
 *
 * WHY THIS IS SEPARATE FROM supabase-target.mjs
 * ---------------------------------------------
 * supabase-target.mjs guards Node operator scripts, which connect through an
 * explicit connection string. It cannot help with the Supabase CLI, which
 * resolves its target from supabase/.temp/project-ref whenever it is given
 * --linked. In this checkout that file holds the PRODUCTION ref, so
 * `supabase db push --linked`, `supabase db reset --linked` and
 * `supabase migration repair --linked` all point at the live database.
 *
 * THE SECOND HALF OF THE HAZARD, WHICH IS EASY TO MISS
 * ---------------------------------------------------
 * The CLI also cannot see this repository's migrations. They live in
 * db/migrations and are named NNNN_*.sql; the CLI looks in supabase/migrations
 * for timestamp-named files, and this checkout has no supabase/migrations
 * directory and no supabase/config.toml at all. `supabase migration list
 * --linked` confirms it: every remote version is listed and the Local column
 * is entirely empty.
 *
 * So a push here is not "apply my one new migration". It is an operation with
 * no defined scope aimed at a production database. Combined with a link that
 * points at production, that is the worst combination available, and it is one
 * command away for anyone who reaches for the obvious tool.
 *
 * The documented route for a production migration in this repository is the
 * Supabase MCP `apply_migration` tool after a rehearsal; see db/README.md.
 *
 * These functions are pure, so every refusal path is testable without a CLI,
 * a network, or a database.
 */

import { PRODUCTION_PROJECT_REF } from "./supabase-target.mjs";

/** CLI invocations that mutate a remote database or its migration history. */
const MIGRATION_MUTATING_COMMANDS = [
  ["db", "push"],
  ["db", "reset"],
  ["db", "remote", "commit"],
  ["migration", "up"],
  ["migration", "down"],
  ["migration", "repair"],
];

/**
 * Read-only and local-only commands are deliberately absent from the list, and
 * `--dry-run` is explicitly allowed through: inspecting what a push would do is
 * the step an operator should take first, and refusing it would push people
 * away from the safe action rather than towards it.
 */
export function isMigrationMutatingCommand(args) {
  if (args.includes("--dry-run")) return false;
  return MIGRATION_MUTATING_COMMANDS.some(
    (command) =>
      command.length <= args.length &&
      command.every((part, index) => args[index] === part)
  );
}

export function explicitProjectRef(args) {
  const index = args.indexOf("--project-ref");
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

/** The ref the CLI would act on: an explicit flag wins over the stored link. */
export function resolveCliTargetRef({ args, linkedRef }) {
  return explicitProjectRef(args) ?? linkedRef ?? null;
}

/**
 * Refuse a migration-mutating CLI command that would resolve to production.
 *
 * Fails closed on an unknown target too: "I could not tell which project this
 * is" is not a reason to continue against a database that might be production.
 */
export function assertCliMigrationTarget({
  args,
  linkedRef,
  allowProduction = false,
}) {
  const ref = resolveCliTargetRef({ args, linkedRef });
  if (!isMigrationMutatingCommand(args)) {
    return { mutating: false, ref };
  }
  if (!ref) {
    throw new Error(
      "Cannot determine which project this Supabase CLI migration command would target; refusing to continue."
    );
  }
  if (ref === PRODUCTION_PROJECT_REF && !allowProduction) {
    throw new Error(
      "Refusing to run a migration-mutating Supabase CLI command against the production project."
    );
  }
  return { mutating: true, ref };
}

/**
 * Refuse a migration-mutating command when the CLI has no local migration set.
 *
 * This is the check that would have stopped the tempting shortcut: with an
 * empty local migration set, a push has no scope, so "it will only apply the
 * one new file" is an assumption the CLI does not support.
 */
export function assertCliMigrationScope({ args, hasLocalMigrationSet }) {
  if (isMigrationMutatingCommand(args) && !hasLocalMigrationSet) {
    throw new Error(
      "The Supabase CLI has no local migration set in this checkout, so a push or repair has no defined scope. This repository's migrations live in db/migrations and are applied through the documented route instead; see db/README.md."
    );
  }
  return true;
}
