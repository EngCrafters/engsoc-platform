# Migration Readiness — Engineering Society Platform

**Purpose.** Define what must remain canonical in _this_ repository, which
surfaces are safe migration boundaries, where adapters belong, and what must
never be imported from another repository.

**Status of the upstream constraint.** No teammate repository is present in this
workspace, so nothing about one is assumed or inspected here. This document is a
statement about **this platform's** boundaries only. Anything that depends on the
other repository's shape is marked **BLOCKED — awaiting that repository**.

> Read alongside `docs/ARCHITECTURE_MAP.md` (how the system works),
> `docs/ARCHITECTURAL_INVARIANTS.md` (what must stay true), and
> `docs/DEEPSEEK_PLATFORM_AUDIT.md` (what is currently wrong).

---

## 1. Which architecture is canonical

The canonical definition of the platform is:

| Layer                       | Canonical artifact                                                                                             | Why it cannot be re-derived                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data model**              | `db/schema.ts` + `db/migrations/0000–0023`                                                                     | 24 journaled migrations encode real production history, including a staging-only migration (`0002`), a table rename with policy inheritance (`0016`), and heuristic data mutations (`0020`). A fresh `db:generate` would not reproduce them. |
| **Authorization**           | `public.administrative_access` + `private.can_access_committee` / `lock_committee_access` / `can_review_event` | One predicate serves both RLS and every routine. Reimplementing it elsewhere guarantees divergence.                                                                                                                                          |
| **Access-control contract** | `docs/adr/0012`, `docs/adr/0013`, `docs/adr/0014`, `docs/ACCESS_CONTROL.md`                                    | These are owner decisions, not engineering preferences.                                                                                                                                                                                      |
| **Security boundary**       | `app_runtime` (no table DML) + `uc02_routine_owner` + 28 granted routines                                      | Verified in the DDL: the runtime role has zero table privileges in any schema.                                                                                                                                                               |
| **RLS**                     | `0004`, `0006`, `0016`, `0022`                                                                                 | RLS is enabled _and forced_ on all ten public tables plus `private.uc02_audit`.                                                                                                                                                              |
| **Audit**                   | `private.uc02_audit` + append-only-by-grant                                                                    | No role holds `UPDATE`/`DELETE`/`TRUNCATE` on it.                                                                                                                                                                                            |
| **Auth/session**            | `lib/auth/*`, `proxy.ts`, `app/auth/callback/route.ts`                                                         | Encodes token-path handling, PKCE intent, allow-listed redirects and the origin policy.                                                                                                                                                      |
| **Deployment**              | `.vercel/repo.json` + Vercel GitHub integration                                                                | ADR 0001/0007: one deployment path, no competing pipeline.                                                                                                                                                                                   |

### Repository facts that constrain any migration

- **The application has no API layer.** Every mutation is a Next.js Server
  Action; the only route handlers are the CSV export and the Auth callback.
  `app/(marketing)/README.md` states: "There is no API route in this folder and
  none should be added here."
- **The public site already lives in this repository**, deliberately, so it can
  call `lib/events` directly instead of a network API (`README.md`).
- **The public site reads with the same restricted runtime role** — it is not a
  privileged path and not a separate data model.

---

## 2. Canonical components that must remain

Anything in this list is a **protected area**. It may be _consumed_ by migrated
code; it must not be reimplemented, forked, duplicated, or replaced.

### 2.1 Must never be replaced by another repository's code

| Area                 | Files                                                                                                                                                                                                | Reason                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**             | `lib/auth/server.ts`, `lib/auth/admin.ts`, `lib/auth/manager.ts`, `lib/auth/callback.ts`, `lib/auth/paths.ts`, `lib/supabase/proxy.ts`, `proxy.ts`, `app/auth/callback/route.ts`, `app/auth/reset/*` | Sole holder of the service-role key; sole implementation of the redirect allow-list, PKCE/recovery handling, and the production https/non-loopback rule. |
| **Access control**   | `lib/access/server.ts`, `lib/access/messages.ts`, `app/admin/(protected)/access/*`, migrations `0016`, `0017`, `0019`, `0021`, `0023`                                                                | Implements the owner-approved hierarchy; contains the last-Technical guard and the self-escalation refusal.                                              |
| **DB schema**        | `db/schema.ts`, `db/migrations/**`, `db/index.ts`, `drizzle.config.ts`                                                                                                                               | The data model _is_ the contract (`CLAUDE.md`: "The data model is the contract… Never the reverse").                                                     |
| **RLS + grants**     | Migrations `0004`, `0006`, `0016`, `0022`                                                                                                                                                            | The security boundary. Weakening or re-deriving it silently changes what every other component can do.                                                   |
| **Private routines** | All `private.*` functions                                                                                                                                                                            | They are the only write path. The runtime role has no alternative.                                                                                       |
| **Registrations**    | `lib/registrations/*`, `app/(marketing)/actions.ts`, `app/(marketing)/registration-form.tsx`, `private.register_for_event`                                                                           | Owns duplicate prevention, capacity, FIFO waitlist, rate limiting and audit atomicity.                                                                   |
| **Event lifecycle**  | `lib/admin-events/*`, `app/admin/(protected)/events/*`, the nine lifecycle routines                                                                                                                  | Owns revision locking, review invalidation, self-approval denial and archive semantics.                                                                  |
| **Audit**            | `private.uc02_audit`, the access-activity tab, `private.list_access_audit`, `private.list_user_audit`, `private.record_auth_admin_action`                                                            | The permanent record. Its action vocabulary is a closed `CHECK` list.                                                                                    |
| **Admin security**   | `lib/security/request-origin.ts`, `app/(marketing)/action-state.ts` (the `"use server"` export rule), `lib/admin-errors.ts`                                                                          | Encodes the CSRF boundary and the "never leak internals" rule.                                                                                           |
| **CI/deployment**    | `.github/workflows/ci.yml`, `.husky/*`, `commitlint.config.js`, `next.config.ts` (security headers), `.vercel/repo.json`                                                                             | One validated, gated delivery path.                                                                                                                      |

### 2.2 Conventions that must be preserved by any migrated code

1. **`"use server"` modules export only async functions.** Types and constants
   live in sibling `*-state.ts` / `*-types.ts` files. This is a production-crash
   rule, documented in `app/(marketing)/action-state.ts`.
2. **`import "server-only"` on every module that touches the database, the
   service-role key, or the local-review escape hatch.**
3. **Domain modules are imported only through their `index.ts`.**
4. **Server actions never accept a client-supplied actor.** The actor is always
   resolved from the session.
5. **Error codes map to fixed human copy.** No SQL, stack, token or provider text
   reaches a user.
6. **Every mutation carries an expected `revision`** where the target supports it.

---

## 3. Safe migration boundaries

A **safe boundary** is a seam where a different implementation can be substituted
without touching canonical security, data, or audit behaviour.

### 3.1 Safe: presentation-only surfaces

| Boundary                                        | Contract to preserve                                                                           | Notes                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Marketing page components (`app/(marketing)/*`) | Must call `getPublicEventPage` / `getPublicEvent` from `@/lib/events` and render `PublicEvent` | Layout, typography, cards, empty/loading/error states are all replaceable. The **data source is not.** |
| `components/ui/*`                               | The public component API used by the rest of the app                                           | 30 shadcn primitives; a design-system migration can replace them wholesale.                            |
| `components/admin/*` — presentational only      | Props shape; no data fetching, no authorization decisions                                      | Keep `lib/admin-*` untouched.                                                                          |
| `app/globals.css` tokens                        | Semantic token names                                                                           | ADR 0011 already mandates a monochrome system; a theme change is safe if tokens keep their meaning.    |
| Copy, icons, motion                             | —                                                                                              | `lib/motion/variants.ts` is a shared token module, so motion changes should go through it.             |

### 3.2 Safe: additive, outbound integration points

| Boundary                                       | Shape                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **New read-only API for an external consumer** | Add a **new** route handler that calls the existing `lib/*` domain functions. Do **not** add routes inside `app/(marketing)/`. |
| **New adapter module**                         | A new `lib/<name>/` module that imports canonical modules and exposes a narrowed interface.                                    |
| **Server-side scheduled job**                  | A new script plus a new routine; it must not bypass audit.                                                                     |

### 3.3 NOT safe: canonical seams that must not be redrawn

| Seam                                                                                       | Why                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Replacing `lib/events` or `lib/registrations` with an HTTP client to another service       | Would move the security boundary out of the database and break I-09/I-19/I-20.                                                               |
| Reading `public.events` or registrations with a direct Supabase client from the browser    | `anon` holds only a column-level SELECT on `events`; registrations are unreachable by design (I-13).                                         |
| Giving a migrated component the service-role key                                           | `lib/auth/admin.ts` is `server-only` and is the only reader (I-30).                                                                          |
| Adding a second deployment pipeline                                                        | ADR 0001/0007: Vercel's GitHub integration is the sole path.                                                                                 |
| Changing `app_runtime` grants to allow direct table access                                 | That would delete the primary security invariant (I-09).                                                                                     |
| Writing to `private.uc02_audit` from anywhere but a routine                                | Append-only is enforced by grant; a new writer needs a new grant, which is a security-model change requiring an ADR.                         |
| Introducing a second role source (a JWT role claim, `app_metadata`, or a local role table) | `administrative_access` is the only authorization source (I-03, I-08). The code explicitly never authorizes from metadata or a cached claim. |

---

## 4. Public-site integration points

The public site is the most likely migration target. Its **data contract** is
narrow and stable.

### 4.1 The public event page contract

```ts
getPublicEventPage(input: { period: "upcoming" | "past"; cursor?: string })
  : Promise<{ events: PublicEvent[]; nextCursor: string | null }>
```

- Page size **20**, cursor-based, opaque base64url cursor encoding
  `{ v, period, date, id }`, validated on decode.
- An invalid or period-mismatched cursor is treated as **no cursor**, not an error.
- Backed by `private.list_public_events` (limit capped 1–50), which returns
  **only** `id, title, description, event_date, location, committee_name, availability`.

### 4.2 The single public event contract

```ts
getPublicEvent(eventId: string): Promise<PublicEvent | null>
```

- Malformed UUID → `null` **without touching the database**.
- Draft, archived or nonexistent → `null` (uniformly).
- Callers render `notFound()`.

### 4.3 The registration contract

```ts
registerForEvent(input: {
  eventId: string; attendeeName: string; attendeeEmail: string;
  intent?: "register" | "join_waitlist"; ipAddress: string;
}): Promise<RegisterForEventResult>
```

Returns a **domain result**, never a raw database error:

`ok: true` | `ok: true, waitlisted: true` |
`invalid_name` · `invalid_email` · `invalid_event` · `invalid_intent` ·
`invalid_ip` · `event_not_found` · `event_not_published` · `event_full` ·
`registration_closed` · `already_registered` · `already_waitlisted` ·
`registration_available` · `rate_limited` · `invalid_input` · `server_error`

### 4.4 What a migrated public site may and may not do

**May:**

- Render `PublicEvent` fields however it likes.
- Drive the public event functions from a Server Component.
- Submit the registration form to `registerForEventAction` **as a Server Action
  from this app**.

**May not:**

- Call Supabase directly from the browser (`anon` has no access to registrations
  and only column-level access to events).
- Add a parallel registration endpoint that bypasses
  `private.register_for_event` — that would lose duplicate prevention, capacity
  serialization, the database-side rate limit, and the audit row.
- Assume the public DTO exposes `status`, `capacity`, counts, or `committee_id`.
  It deliberately does not; `availability` is the only admission signal.

---

## 5. Risky areas

Ordered by the damage a mistake would cause.

| #    | Risk                                                                                                                              | Why it is dangerous                                                                                                                                                                                              | Mitigation                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | **A migration that runs DDL or DML against the linked Supabase project.** `supabase/.temp/project-ref` is the **production** ref. | A `supabase db push` or `db query --linked` without an explicit ref hits production. `scripts/m7-staging-browser-smoke.ts` is already built this way (audit F-01) and contains `DELETE FROM private.uc02_audit`. | Never rely on `--linked`. Always pass and assert an explicit ref. Delete or harden that script.                                              |
| R-02 | **Weakening or bypassing RLS "to make the migration work."**                                                                      | RLS failures are silent (empty results, not errors). A dropped policy looks like a data problem.                                                                                                                 | Any migration touching a policy requires the paired anon-denial test (`CLAUDE.md`).                                                          |
| R-03 | **Re-implementing the scope predicate.**                                                                                          | Two predicate implementations will diverge; cross-committee leakage becomes possible.                                                                                                                            | Call `private.can_access_committee` / `lock_committee_access`. Do not write a new `EXISTS` clause.                                           |
| R-04 | **Bypassing routines for "performance."**                                                                                         | Loses row locking, revision checks, audit atomicity and the rate limiter simultaneously.                                                                                                                         | If performance demands it, add a **new routine**, never a direct query.                                                                      |
| R-05 | **Mutating the `uc02_audit` action vocabulary.**                                                                                  | Four migrations already rewrite that `CHECK` by DROP+ADD, each validating every existing row. A value outside the new list aborts the migration mid-file.                                                        | Add values; never remove them. Keep the list strictly cumulative.                                                                            |
| R-06 | **Running migrations without a rehearsal and a fresh backup.**                                                                    | No production rollback has ever been executed, PITR is disabled, and there are no automated backups.                                                                                                             | Rehearse on a disposable PG 17 container; take and verify a snapshot; record the checksum.                                                   |
| R-07 | **Touching `app/auth/callback/route.ts` or `proxy.ts` casually.**                                                                 | A regression here breaks every sign-in and every recovery link, and the allow-list / no-localhost rules are the only thing preventing redirect abuse.                                                            | Any change must keep the auth callback tests and the admin-auth e2e spec green, and be re-verified in the deployed environment.              |
| R-08 | **Assuming the docs describe deployed state.**                                                                                    | Ten documented contradictions exist (audit §9), including three different statements of the migration head.                                                                                                      | `docs/UC-02_Data_and_Security.md`: "The migration chain and live catalog, rather than this design document alone, establish deployed state." |
| R-09 | **Adding a column or table without a written decision.**                                                                          | `CLAUDE.md`: "Never add a column or table that isn't backed by a written decision."                                                                                                                              | ER diagram or ADR first, then schema, then code.                                                                                             |
| R-10 | **Trusting a local format-check failure on Windows.**                                                                             | It currently fails on every file because of CRLF (audit F-07), so it carries no signal locally.                                                                                                                  | Add `.gitattributes` before relying on it; trust CI on Linux meanwhile.                                                                      |
| R-11 | **Relying on the build or test scripts locally without credentials.**                                                             | Both fail on this machine for environmental reasons (audit F-02, F-06), which can be misread as code breakage.                                                                                                   | Provide a rehearsal runtime URL plus staging keys, or run these gates only in CI.                                                            |
| R-12 | **Deleting a referenced Auth identity.**                                                                                          | Every FK to `auth.users` is `ON DELETE no action`; audit rows are never deleted.                                                                                                                                 | Follow the runbook's exceptional-deletion gate; the default outcome is a retained no-access identity (I-07).                                 |

---

## 6. Adapter candidates

An adapter is warranted where a **narrow, stable interface** already exists and
the implementation behind it could legitimately change. These are seams the
codebase already provides — no new abstraction needs inventing.

| #    | Candidate                      | Existing interface                                                                                                                                                              | What an adapter isolates                                                          | Risk                                                                                                                                   |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | **Public event data source**   | `lib/events` `getPublicEventPage` / `getPublicEvent` + the `PublicEvent` type                                                                                                   | Whether events come from `private.list_public_events` or from a future read model | **Low** — the DTO is already narrow and version-cursored. The only rule is that `availability` must stay derived server-side.          |
| A-02 | **Registration submission**    | `lib/registrations` `registerForEvent` + the closed error union                                                                                                                 | Transport only. The **rules must stay in the routine.**                           | **High if misused** — an adapter that reimplements validation or capacity is a security regression.                                    |
| A-03 | **Auth identity operations**   | `lib/auth/admin.ts` (`inviteAuthUser`, `createAuthUserWithPassword`, `createAuthUserWithoutPassword`, `resendAuthInvitation`, `sendPasswordResetEmail`, `setTemporaryPassword`) | Which identity provider performs them                                             | **Medium** — this is the only service-role reader; any replacement must keep it server-only and must never return a password or token. |
| A-04 | **Email delivery**             | Currently **no application adapter** — Auth email is Supabase SMTP through Resend; `RESEND_API_KEY` and the `resend` npm package are both unused                                | A future application-originated transactional email path                          | **Low** — greenfield. If added, it belongs in a new server-only `lib/email/` module and must not be imported by any Auth path.         |
| A-05 | **Audit read surface**         | `private.list_access_audit`, `private.list_user_audit`                                                                                                                          | Presentation of history                                                           | **Low** — read-only, Technical-scoped, already limit-bounded (100 / 50).                                                               |
| A-06 | **CSV export**                 | `buildRegistrationCsv` (pure) + `private.export_admin_registrations`                                                                                                            | Output format only                                                                | **Medium** — formula neutralization and the count/limit guards must be preserved.                                                      |
| A-07 | **Admin navigation and shell** | `components/admin/admin-navigation.ts`, `admin-shell.tsx` props                                                                                                                 | Presentation                                                                      | **Low** — but the Technical nav group must remain gated on `accessLevel`, even though the database is the real boundary.               |
| A-08 | **Design system**              | `components/ui/*` plus token names in `app/globals.css`                                                                                                                         | Visual implementation                                                             | **Low**                                                                                                                                |

**Non-candidates.** Do **not** introduce adapters for: the access-control
predicate, RLS policies, the routine signatures, the audit schema, or the
deployment path. Those are the contract, not an implementation detail.

---

## 7. What must NOT be migrated from another repository

Stated as explicit prohibitions.

1. **Any authentication implementation.** No parallel login, session, cookie,
   recovery, invitation or password-reset path. `lib/auth/*`, `proxy.ts` and
   `app/auth/callback/route.ts` are the only ones. A second auth path would
   create a second answer to "who is this?" that the database does not recognize.
2. **Any authorization model.** No role enum, permission table, JWT role claim,
   `app_metadata` role, email allow-list, or client-side role check that
   substitutes for `administrative_access`. ADR 0012 forbids inferring access from
   names, emails, metadata or UI state.
3. **Any database schema or migration.** No table, column, index, constraint,
   enum or migration file from another repository. `CLAUDE.md`: the data model is
   the contract; a change requires a written decision first.
4. **Any RLS policy or grant.** Policies and grants ship in the same migration as
   the object they protect. Importing a policy set would silently change the
   security boundary.
5. **Any `SECURITY DEFINER` routine.** All privileged SQL lives in
   `db/migrations/` and is owned by `uc02_routine_owner` with
   `search_path = public, pg_temp`.
6. **Any write path to `public.registrations`.** One routine, one set of
   invariants. A second writer would defeat the partial unique index's intent, the
   event lock, and the audit guarantee.
7. **Any event lifecycle implementation.** Revision locking, review invalidation
   and self-approval denial are enforced across nine routines plus a `CHECK`; a
   parallel implementation cannot preserve them.
8. **Any audit writer.** The action vocabulary is a closed `CHECK` list and
   append-only is enforced by grant.
9. **Any CI/CD pipeline, deployment configuration, or Vercel/Netlify/Cloudflare
   project.** ADR 0001 and ADR 0007 make Vercel's GitHub integration the sole path.
10. **Any secret or credential.** Not service-role keys, not database URLs, not
    SMTP credentials, not tokens. `.env.example` is the complete variable list.
11. **Any client component that reads the database directly.** All data access
    goes through server-only modules.
12. **Any component that assumes the public API exposes internal fields**
    (status, capacity, counts, committee ids).

### Non-negotiable invariants for any migrated code

Summarized from `docs/ARCHITECTURAL_INVARIANTS.md`; these must remain PROVEN after
the migration:

I-01 · I-02 · I-03 · I-04 · I-05 · I-06 · I-08 · I-09 · I-10 · I-11 · I-12 ·
I-13 · I-14 · I-15 · I-17 · I-19 · I-20 · I-21 · I-22 · I-24 · I-27 · I-28 ·
I-29 · I-30 · I-31 · I-32

---

## 8. Pre-migration checklist

Complete **before** any migration code is written.

### Environment (blocking today)

- [ ] Provide a rehearsal `APP_RUNTIME_DATABASE_URL` (disposable or staging) — required for the production build.
- [ ] Provide `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`, or change the staging RLS test to skip rather than throw (audit F-02).
- [ ] Confirm Docker Desktop is running so the DB and e2e suites can provision `postgres:17-alpine`.
- [ ] Add `.gitattributes` (`* text=auto eol=lf`) so the format gate carries signal on Windows (audit F-07).
- [ ] Install the Vercel CLI if independent deployment verification is required.

### Safety (blocking before any write)

- [ ] Resolve **R-01**: remove or harden `scripts/m7-staging-browser-smoke.ts` so no write can reach the production project.
- [ ] Take a fresh production snapshot and record its size and checksum.
- [ ] Rehearse the exact migration chain against a disposable PostgreSQL 17 container.
- [ ] Prove a restore of that snapshot in an isolated instance.
- [ ] Confirm the applied production migration head by reading `supabase_migrations.schema_migrations` — never from documentation (audit D-03).
- [ ] Verify production role and RLS state read-only (`scripts/m8-production-role-check.mjs` is read-only and ref-allowlisted).

### Baseline (blocking before declaring success)

- [ ] Record the pre-migration test totals so a post-migration drop is detectable.
- [ ] Capture the pre-migration route inventory and the security-header response set.
- [ ] Confirm CI is green on the current HEAD and note the run id.

### Governance

- [ ] Resolve audit blocker **B-05** — the real Support manager identity, assignment and pilot.
- [ ] Resolve audit blocker **B-06** — the owner's explicit choice of the next use case, which is what actually closes UC-02.
- [ ] Resolve the documentation contradictions in audit §9 that touch the migration (at minimum D-01, D-02, D-03), so the migration design is not built on a stale statement.

---

## 9. Open questions for the migration design phase

These cannot be answered from this repository alone.

1. **Which repository owns the public site after the migration?** The current
   design deliberately keeps it here so it reads the database directly. Splitting
   it requires deciding the public data contract (adapter A-01) and who operates
   the deployment.
2. **BLOCKED — awaiting the teammate repository.** Its stack, its data access
   pattern, and whether it assumes a Supabase client or an HTTP API. Without it,
   no integration boundary can be specified.
3. **Does the migration add a second deployable?** If so, ADR 0001/0007 must be
   superseded explicitly, not worked around.
4. **Who holds `app_maintenance` during and after the migration?** It is the
   recovery credential and the only path to `set_technical_access`.
5. **What is the recovery objective?** PITR is disabled and there is no automated
   backup; a migration without a defined RTO is a migration without a rollback.

---

## 10. Summary

**Safe to migrate:** public presentation, UI components, design tokens, and any
new read-only consumer built on the existing `lib/events` contract via a new
adapter.

**Must remain canonical:** auth, the access hierarchy and its predicate, the
schema and migrations, RLS and grants, the private routines, registration and
event-lifecycle logic, the audit table, admin security, and CI/deployment.

**Must not be imported from anywhere:** any second auth path, authorization
model, schema, policy set, privileged routine, registration writer, lifecycle
implementation, audit writer, deployment pipeline, or secret.

**Before anything is written:** fix R-01, take and verify a backup, rehearse on a
disposable database, and confirm the applied migration head from the database
itself rather than from the documentation.
