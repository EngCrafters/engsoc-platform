# db

Drizzle ORM schema (`schema.ts`), client (`index.ts`), and hand-journaled
SQL migrations (`migrations/`) for the whole platform. `docs/UC-02_Data_and_Security.md`
is the authoritative target contract for UC-02's part of this schema; this
file documents what's actually here and how the pieces fit together.

## Client (`index.ts`)

A server-only Drizzle client over `APP_RUNTIME_DATABASE_URL`, using the
restricted `app_runtime` role created by the UC-02 security migration —
there is no fallback to `DATABASE_URL` (that's a migration-only credential;
see "Applying migrations" below). The runtime role has no table DML grants;
all reads and writes call fixed private routines. It uses Supabase's shared
transaction pooler with one application-side connection, no prepared
statements, and required TLS — except when the hostname is `127.0.0.1` or
`localhost`, which is only ever the disposable Postgres container the
isolated test suites (`tests/db`, `tests/e2e`) run against and which has no
TLS listener at all.

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
(attempt-purge tooling and, since `0010`, the only role that can run the grant/revoke routines; run by the owner, not the app), and
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

`0005_uc02_registration_routine_hardening.sql` is a forward routine-only
change: it serializes attempts per IP with a transaction advisory lock and
enforces the rolling five-attempt limit inside the trusted database boundary.

`0006_uc02_enable_rls_all_tables.sql` reconciles the historical environment
split: main did not receive staging-only migration `0002`, so this forward
migration enables and forces RLS across all public domain tables. Deferred
tables have no policies and are therefore default-deny.

`0010_uc02_maintenance_grant_routines.sql` adds the only write path for
committee-manager grants: `private.grant_committee_manager` and
`private.revoke_committee_manager`. Each writes the grant and its
`grant.activated` / `grant.revoked` audit row in one transaction, is idempotent
(`ALREADY_ACTIVE` / `ALREADY_REVOKED` write nothing), validates the committee,
user and actor, and derives `changes.bootstrap` for a committee's first active
manager. Only `app_maintenance` can execute them (denied to `app_runtime`, `anon`,
`authenticated`, `service_role`), and the same migration removes
`app_maintenance`'s direct INSERT/UPDATE on `committee_managers` and INSERT on
`private.uc02_audit`. No schema change. See `docs/Platform_Maintenance_Runbook.md`.

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

`0011_uc02_admin_event_detail.sql` adds `private.get_admin_event(actor, event_id)`,
the read-only detail counterpart of `list_admin_events` (0009). It uses the same
active-grant predicate through `app_runtime`, so an event shown in the admin list
always opens in the detail view; a missing or out-of-scope event returns no row.
