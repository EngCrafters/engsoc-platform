# db

Drizzle ORM schema (`schema.ts`), client (`index.ts`), and hand-journaled
SQL migrations (`migrations/`) for the whole platform. `docs/UC-02_Data_and_Security.md`
is the authoritative target contract for UC-02's part of this schema; this
file documents what's actually here and how the pieces fit together.

## Client (`index.ts`)

A server-only Drizzle client over `DATABASE_URL`, using the `postgres` role
directly — this bypasses Row Level Security entirely, which is why
`DATABASE_URL` must never be a client-exposed secret. UC-02's target design
(section 7 of the data contract) replaces this with a restricted
`app_runtime` connection once M3 wires it up; until then, application code
under `lib/` is trusted the same way this direct connection is.

## Schema (`schema.ts`)

One export per table, grouped by domain area, each with a comment
explaining its role and current RLS status. Two non-table exports matter
for UC-02:

- `authUsers` — a minimal stub of Supabase's own `auth.users` table (just
  the `id` column), so other tables can declare a real FK to it. **Never**
  let a generated migration actually `CREATE TABLE auth.users` — that table
  already exists on every real Supabase project. Strip that one statement
  before applying anywhere except a from-scratch disposable rehearsal DB.
- `privateSchema` — the `private` Postgres schema, never exposed through
  PostgREST. Currently holds one table, `uc02_audit` (permanent,
  append-only mutation history).

## Migrations (`migrations/`)

Numbered SQL files plus a Drizzle journal/snapshot pair per migration in
`migrations/meta/`. Two kinds:

- **Generated** (`0000`, `0001`, `0003`): produced by `drizzle-kit generate`
  from `schema.ts` — tables, columns, indexes, CHECK constraints.
- **Hand-written** (`0002`, `0004`): roles, grants, RLS policies, and
  `SECURITY DEFINER` routines. Drizzle's schema builder doesn't model these,
  so they're plain SQL, journaled the same way so `drizzle-kit check` still
  sees a consistent history (each hand-written migration's snapshot is
  identical to the one before it — no column-level change to diff).

`0004_uc02_security_foundation.sql` creates three roles: `app_runtime`
(what the Next.js server will connect as, once M3 wires it up — no direct
table grants, only `EXECUTE` on the routines below), `app_maintenance`
(grant/audit/attempt-purge tooling, run by the owner, not the app), and
`uc02_routine_owner` (`NOLOGIN`, owns the routines, holds the actual table
grants they need). Both login roles are created with a placeholder
password that must be rotated with `ALTER ROLE ... WITH PASSWORD` on any
real project immediately after the migration runs — never commit the real
value.

The routines in `private.` (`register_for_event`, `flag_review`,
`approve_event`, `publish_event`, `hold_event_full`, `archive_event`,
`restore_event`, `promote_waitlist`) are UC-02's only write path once M3
switches the app over to them: each locks the event row `FOR UPDATE`,
re-checks state after the lock, mutates, writes one audit row, and returns
a `jsonb {code, ...}` result matching the deep dive's result-code
vocabulary (section 7). See `docs/UC-02_Data_and_Security.md` sections 5-8
for the full contract these implement.

## Applying migrations

`npm run db:migrate` replays the journal via Drizzle against `DATABASE_URL`.
Never point that at a project you don't intend to migrate — confirm the
target with `npm run db:studio` or a direct query first, per CLAUDE.md's
"never run migrations or seed data against production." Migrations reaching
a live Supabase project (staging or main) in this project's history have
gone through the Supabase MCP `apply_migration` tool instead, rehearsed
first against a disposable local Postgres container — see
`docs/UC-02_Data_and_Security.md` section 10's rehearsal evidence for the
exact method.
