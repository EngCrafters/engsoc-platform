# Current work - handoff state

**CURRENT — REGISTRATION PHONE + ADMIN DISCOVERABILITY (branch
`feature/registration-phone`, pull request #6):**

**1. Registration now captures name, email and phone.** Migration `0024` adds one
nullable `attendee_phone text` column, one CHECK, one pure helper
(`private.normalize_phone`) and replaces three routines. The column is nullable
because every registration captured earlier keeps its NULL phone and stays
valid — nothing is fabricated or backfilled. Every NEW registration must supply
a valid number, enforced twice: `lib/registrations/phone.ts` in the domain and
`private.register_for_event` in the database, with
`registrations_phone_canonical` as the last line of defence against a direct
writer. The canonical form is an optional leading `+` then 7–15 digits, text
never numeric, not unique and not indexed. Email remains the registration
identity.

**Replacing a routine's argument list is not a `CREATE OR REPLACE`.** It would
create a second, overloaded function and leave the old one executable by
`app_runtime` as a live write path accepting no phone. Migration 0024 drops
`register_for_event` explicitly, drops and recreates both admin registration
routines for the same reason (`RETURNS TABLE` cannot be replaced either),
restores the `EXECUTE` grant to `app_runtime` and nothing else, and then asserts
its own outcome — exactly one `register_for_event`, six-argument signature — so
no half-applied state is possible. That assertion caught a real bug in its own
first draft.

**2. The administration side shows the phone.** `list_admin_registrations` and
`export_admin_registrations` return it on the same row and the same single
query they already used, so nothing became N+1 and registration is still one
routine call. A registration captured before the field existed shows
"Not captured" in the admin table and an empty cell in the CSV — never a
placeholder word, never an invented number. The CSV value goes through the same
formula-prefix neutralization as every other cell: an international number
starts with `+`, which is a spreadsheet formula prefix, so it is deliberately
not special-cased.

**3. The public site no longer advertises the administration sign-in.** The
header, mobile menu, footer and join invitation carried a link to
`/admin/login`; they no longer do, and `content/site.ts` has no `signInUrl`.
`/admin/login`, `/admin/recovery` and `/auth/reset` all still work, protected
pages still redirect a signed-out visitor, and recovery links still resolve. The
three entry pages are now `noindex`. This is **discoverability, not
authorization** — the route's own guards are what protect it, and the e2e test
asserts both halves.

**Known coverage limitation, stated rather than papered over:** the
authenticated admin leg is not exercised in a browser. The e2e environment runs
with a placeholder Supabase URL, so there is no Auth server to sign a manager in
against, and this change will not invent a production identity to work around
that. The admin path is proven at the routine level (scope, denial, phone
returned) and the component level (rendering, including the NULL case).

### Release state — read this before merging

**Branch `feature/registration-phone` (PR #6) is complete and verified, but
MUST NOT be merged to `main` until migration 0024 is applied to production.**

That ordering is a hard dependency, not a preference. Migration 0024 **drops**
the five-argument `private.register_for_event` and replaces it with a
six-argument one. Production still has only the five-argument form. The new
application code calls the six-argument form, so deploying before migrating
makes **every registration fail** with `SERVER_ERROR`
(`function private.register_for_event(...) does not exist`). The upgrade
rehearsal recorded exactly this starting state: before 0024, the only routine
present is `private.register_for_event(uuid,text,text,text,inet)`.

Correct order: **apply 0024 → verify → merge → Vercel deploys.**

**Why the migration was not applied in this session.** It is written, reviewed,
and rehearsed twice (zero-to-head, and production-state 0023 → 0024 with a real
historical row), and it is purely additive. The blocker is the route, not the
change:

1. This repository's documented path for a production migration is the Supabase
   MCP `apply_migration` tool (`db/README.md`). That tool is not available in
   the session that produced this branch.
2. `supabase db push` is **not** a safe substitute here. Production's history in
   `supabase_migrations.schema_migrations` is timestamp-versioned
   (`20260913025836` … `20261007090000`), while this repository's files are
   `NNNN_`-named. `supabase migration list --linked` shows the **Local column
   entirely empty**, so a push would not apply the one intended migration.
3. **No credential capable of applying DDL to production exists in this
   environment, or in the Vercel project at all.** `vercel env ls production`
   lists `APP_RUNTIME_DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and **no
   `DATABASE_URL`**. `app_runtime` has no table grants and no `CREATE`
   privilege — it cannot run `ALTER TABLE` and must not be given the right to.
   The service-role key is a PostgREST/Auth credential, not a direct Postgres
   one. So this is not a limitation of the session that produced the branch: the
   migration-only credential described in `db/README.md` is simply not
   provisioned in the project.
4. `docs/Platform_Maintenance_Runbook.md` requires a fresh restorable logical
   backup, inspected and restored to an isolated instance, before a schema
   change. The project has no proven backup or PITR window, so that
   precondition cannot currently be met.

5. **Taking the backup the runbook requires is itself an owner decision.**
   `docs/Platform_Maintenance_Runbook.md` gates a schema change behind a fresh
   restorable logical backup, inspected and restored to an isolated instance.
   Producing one means copying the society's registrations — real attendee
   names, emails and now phone numbers — to an unmanaged local file outside any
   retention or access control. That is a data-handling decision, not an
   engineering shortcut, and it is not mine to take.

Also note `supabase/.temp/project-ref` points at **production**
(`rbeyqrfypowyocmnmvwu`) — risk **R-01** in `docs/MIGRATION_READINESS.md`. Any
Supabase CLI command that resolves its target implicitly will hit production.
Do not run `db push`, `db reset`, or `migration repair` against the linked
project. `npm run db:target` is now a fail-closed preflight for exactly this:
it reports the linked project, refuses any migration-mutating CLI command that
would resolve to production or whose target cannot be determined, and refuses a
push outright because this checkout has no local migration set for the CLI to
scope it by. `db push --dry-run`, `migration list` and `db dump` still pass, so
inspecting scope stays the easy path. See `db/README.md`.

**To finish the release**, in this order:

1. Apply `db/migrations/0024_registration_attendee_phone.sql` to the production
   project through the documented `apply_migration` route.
2. Verify read-only: the `attendee_phone` column exists and is nullable, the
   `registrations_phone_canonical` CHECK is present, exactly one
   `register_for_event` exists with signature
   `uuid, text, text, text, text, inet`, the five-argument form is gone,
   `EXECUTE` is granted to `app_runtime` only, and `app_runtime` still has no
   direct table privilege on `public.registrations`.
3. Merge PR #6. Vercel deploys production from `main` automatically.
4. Verify read-only on production: `/events` still lists events, an event page
   renders the phone field with `type="tel"`, no public page contains an
   `/admin` anchor, `/admin/login` still returns 200, and
   `/dev/design-system` is still 404.

The dated handoffs below are historical.

**CURRENT — PUBLIC SITE MIGRATION (branch `migration/public-site`, pull request #5):**
The teammate public site (ESWebsite, upstream `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0`)
has been ported into this application as **presentation only**. Auth, authorization,
the schema, RLS, the private routines, registration, the audit trail and the admin
area are unchanged.

What a visitor gets: `/` is the society's public experience (hero, figures, overview,
upcoming events, programmes, projects, disciplines, leadership, join invitation);
`/events` is a real route serving live published events; `/events/[id]` keeps the
canonical detail page and registration form; `/about` and `/activities` are new; and
English/Arabic render with correct right-to-left direction from a server-resolved
cookie, so the language never flashes.

Events come from `lib/events` and nowhere else. The upstream sample event list and
its "registration is not open" preview dialog are **not** carried over, because this
platform really does register people. Registration still posts to the canonical
Server Action and `private.register_for_event`.

The admin area is untouched: its own tokens, its own Geist faces, its own English
direction. The public palette is scoped to `.marketing-surface`, and the public
`dir` is applied to that subtree rather than to `<html>`.

Deliberately **not** introduced: GSAP, React Three Fiber and drei. ADR 0011 removed
GSAP from this repository on purpose, and the hero's prepared stills already carry
the identity at first paint. The live WebGL sculpture is recorded as DEFER with a
re-entry path, not dropped. CSS Modules were re-expressed in the existing Tailwind
and shadcn system so the application does not end up with two styling systems.

Hardening delivered in the same branch, from the audit:

- `scripts/m7-staging-browser-smoke.ts` is **removed**. It could issue
  `DELETE FROM private.uc02_audit` against whichever project
  `supabase/.temp/project-ref` names — production in a normal checkout.
- `scripts/lib/supabase-target.mjs` derives the project ref from the connection
  identity and fails closed unless a non-production ref is named explicitly.
  Both remaining role-check scripts use it, with tests.
- **`npm test` is hermetic.** The live staging RLS proof moved to
  `tests/integration/` behind its own config; CI still runs it as an explicit gate
  that fails if its variables are unset.
- The committed staging anon key is gone from workflow source; it is a repository
  variable now.
- The production build no longer requires a runtime credential; the fail-fast
  check moved to server startup, where it reports rather than taking the server
  down.
- `.gitattributes` added, so the format gate is meaningful on Windows too.
- The unused `resend` dependency is removed.

**Open item for the owner (Vercel, not code):** the **Preview** environment has no
`APP_RUNTIME_DATABASE_URL`. That previously failed the preview build loudly; now it
is reported at runtime, and the preview correctly renders the marketing shell with
an honest "events are temporarily unavailable" state instead of a 500. Giving
previews a database credential is a data-exposure decision and is left to the owner.

**Sole remaining UC-02 release hold is unchanged:** the real Support manager email,
assignment and private sign-in pilot.

The dated handoffs below are historical. Their account state and open items are
superseded by this note.

**HISTORICAL (October 8, 2026):** **FOCUSED PRODUCTION FIX (October 8, 2026):** CSV export investigation confirmed
native form POSTs sent `Origin: null` under the global `no-referrer` policy;
Vercel Host/forwarded headers and request URL were correct. Registration-only
`same-origin` metadata preserves same-site Origin without cross-site Referer.
The POST guard now uses dedicated server-only `APP_ORIGIN`, rejects missing/null
origins and mismatched Referer, and does not trust proxy hosts. Production
`APP_ORIGIN` is configured to the canonical site. Auth/scope/routines/CSV format
and UI appearance are unchanged. Fix `749cdc5` passed GitHub CI 37766411559 and
Vercel production dpl_E5bMhvFfXRz1VTwGmnoTUXujjdYp is READY. Real browser
confirmed/waitlisted downloads passed with exact private data comparison and
two correctly attributed export audit entries. Local: 256 tests and 43 browser
passes / one intentional skip. Details are in HARDENING_AUDIT_2026-10-07.md;
the prior lifecycle handoff below remains applicable.

**CURRENT (October 8, 2026):** Recovery production pilot **PASS** and Board
production pilot **PASS**, confirmed by the owner. The disposable Support test
identity has been revoked and retains no application access. It remains in Auth
for historical attribution; it has a retained grant and four audit references.
The real Support email has not been supplied. Do not reactivate the placeholder.

The focused access-lifecycle extension in ADR 0014 preserves the existing
Technical / Board / single-committee Manager hierarchy. Migration 0023 adds
atomic selected-manager replacement and serializes all access mutations. It
preserves history, rejects stale scope and competing grants, and uses the existing
UI for Auth-only onboarding, replacement and explicit account/access status.
Supported Admin sign-out needs the target session JWT; no unsupported user-ID
session revocation or automatic Auth deletion is added.

Staging and an isolated restore of a fresh production archive passed the migration
and replacement rehearsal. Migration 0023 is now applied in production; read-only
RLS reconciliation confirms Technical/Board global, Finance/Media one scope each,
and the old Support identity zero scope. A rolled-back Support mutation is denied.
Local gates pass: 232 tests, 37 Playwright passes / one intentional skip, format,
lint, types, db:check, build and diff hygiene. Lifecycle commit f2312a9 is pushed;
GitHub CI 37648796359 passed and Vercel dpl_54CPe83riFnuzwGrDMExdS4YNwyE is READY
on that SHA. Live Technical directory/details/history/onboarding/replacement
controls and mobile checks pass without production account mutations.
The sole remaining release hold is the real Support manager email, assignment
and private sign-in pilot. Final evidence is in HARDENING_AUDIT_2026-10-07.md.
Final evidence commit 730edd7 also passed GitHub CI 37649639032 and reached
Vercel READY at dpl_CFNxAJUNmNA1TFQXyH7znDrsnRVs. October 8 production smoke
checks confirm public/login/recovery/reset responses and the unauthenticated
access redirect with security headers. No application changes followed the
validated lifecycle implementation.
~~No landing-page migration or broad UI redesign has started.~~ **Superseded:**
the public site migration is in progress on `migration/public-site` — see the note
at the top of this file. The admin area still has had no broad UI redesign.

The earlier exposed migration credential was production, not staging: rotation,
old-password rejection, affected private-store updates and log review are complete.
Resend/DNS/delivery, production RLS/grants, backup limitations and log-access 403
cause are verified. A logical restore is proven; paid leaked-password protection,
automated backup/PITR, stronger DMARC/CSP, development advisories, future directory
pagination and the external Auth/audit boundary remain documented follow-ups.

Current authority is ADRs 0012 through 0014 and ACCESS_CONTROL.md. The dated handoffs below
are historical; their old account state and open items are superseded by this note.

**AUTH + USER ADMINISTRATION (October 5, 2026):** Commit `de0a1c1` fixed
password recovery and added the Technical-only user directory at
`/admin/access` (see `docs/AUTH_AND_EMAIL.md` and ADR 0013). Recovery now lands
on `/auth/callback` (PKCE code or token-hash link), `/auth/reset` requires a live
recovery session and a confirmed password, and a root-level relay removes any
`#access_token` fragment (for example from a Dashboard-sent email) from the URL
and completes the sign-in. A production end-to-end run with a throwaway account
passed: fragment relay, callback landing, validation, password update, session
end, sign-in, and the expired-link message. Production Auth URLs were probed
(Site URL and the `/auth/callback` allow-list correct; localhost and foreign
hosts not honoured). Migrations 0021 (directory, per-user audit, secret-free
Auth admin audit) and 0022 were applied to staging then production.

**ACCESS BUG FOUND AND FIXED (0022):** the committee RLS helper read only the
legacy `request.jwt.claim.sub` setting, which Supabase's API no longer sets, so a
signed-in Technical, Board or Manager user saw zero committees and the app
showed "Administrative access not assigned". The local test harness hid it by
setting only the legacy setting. Fixed to read the JSON `request.jwt.claims`
first; the harness's `auth.uid()` stub now mirrors Supabase and
`tests/db/jwt-claims-policy.test.ts` covers it. Production was re-checked in a
rolled-back transaction under real claims: Technical 8 committees, Board 8, no
access 0. Real accounts have not yet signed in since the fix.

**PRODUCTION IDENTITIES (reconciled October 5):** Technical `hishamalhn@gmail.com`;
Board `engineeringsociety.squ@gmail.com`; Committee Managers
`unknown11110000@gmail.com` (Support & Logistics; invitation still unaccepted,
email unconfirmed), `loay1784@gmail.com` (Finance) and
`alshifa.alrawahi112@gmail.com` (Media); the last two were created confirmed
with no password and no email, so they set a password through "Forgot your
password?" once email works, or the Technical team uses a temporary password.
Forum, Evening, Relations and Society Affairs have no manager. Each assignment
is audited with an owner-directed reconciliation note.

**HISTORICAL OCTOBER 5 OPEN ITEMS (superseded by the current note above):** (1) enter the Mailtrap Sandbox SMTP credentials in
Supabase and paste the token-hash templates (`docs/AUTH_AND_EMAIL.md` sections
3-4), then run its verification checklist; Mailtrap is a sandbox only and real
delivery needs a verified domain and provider; (2) the Technical, Board and
Support users sign in to complete the pilot; (3) consider enabling Auth
leaked-password protection (advisor warning).

**ACCESS HIERARCHY INITIATIVE (October 4, 2026):** The owner has explicitly
authorized finalizing application access before any landing-page migration.
The owner initially supplied five emails, then clarified that the Support
address was a placeholder and that the Technical lead will grant the real
manager accounts later. The owner selected transferable
Technical ownership through the application, protected by a last-active-owner
database rule. ADR 0012 records this update. Migrations 0016–0019 were
rehearsed locally and on staging, then applied to production. Local gates
passed: format, lint, typecheck, 136 tests, Drizzle migration check, production
build, 20 Playwright browser tests and diff check. Commit `887a3e2` is deployed;
GitHub CI run `37192635891` passed and Vercel Production deployment
`6839336389` reached success. The follow-up archive commit `dcdd103` also
passed GitHub CI run `37193456285` and reached Vercel Ready at deployment
`dpl_EQmpvevsq94DyCDTaQWPdA5pNk5c`. The existing robot/auth UI was left
intact.
Technical and Board access rows are active and audited. The placeholder Support
grant was revoked immediately after clarification; RLS now gives it zero
visible committees, and `manager.revoked` records both states. Invitations had
already been sent to Technical and the Support placeholder; the latter cannot
access administration even if the invitation is accepted. Board Auth already
existed. Finance and Media accounts were not created or assigned. Technical
Auth confirmed and signed in after deployment at 09:44 UTC. Auth logs also show
a Board password login after deployment, but no authenticated screen checks
have been confirmed. The owner controls both inboxes but does not have both
passwords. Recovery requests between 09:59 and 10:03 UTC for both accounts were
rejected by Supabase Auth with `over_email_send_rate_limit` (HTTP 429); no reset
email was sent by those attempts. Retry through `/admin/recovery` only after the
email quota clears. Because the SSR recovery flow stores a PKCE verifier in the
requesting browser, the owner must submit each request and open its email link
in that same browser/device, then choose passwords without sharing them. An
agent-initiated recovery request would not complete in the owner's browser.
On October 5, the owner reported that a recovery email requested from the
Supabase Dashboard redirected to the site root with session tokens in the URL.
The exposed refresh session was globally signed out through Supabase Auth
(HTTP 204). Access tokens may remain valid until their expiry; the link must
not be reused. The owner should request a fresh link from the production
`/admin/recovery` page in the browser where they will open the email. No link,
token, or password was recorded in this repository.
The production pilot remains unverified; the manager pilot also needs the real
Support identity from the owner.
Migration 0020 was applied to production after backup and migration safety
checks. It renamed only the confirmed M8 smoke identity to `Legacy Events
(archived M8 smoke)`, preserved its five event and four registration IDs, and
recorded the archive with IDs, counts and timestamp. The archive path passed
local backup/restore tests; staging's four active non-smoke `Events` records
were correctly left untouched.
[ADR 0012](adr/0012-application-access-hierarchy.md) and
[ACCESS_CONTROL.md](ACCESS_CONTROL.md) record the three levels, single-committee
manager rule, eight-committee catalog, audit and rollout gates. The specification
was pushed in `b73b6ec` and GitHub CI run `37170504881` passed. Production
read-only inspection found one `Events` committee with five archived M8 smoke
events, four registrations and one active manager; staging had the same
committee ID, four events and two active managers. The owner decided to keep
`Events` isolated as legacy smoke data and to allow a different Board or
Technical actor to review. Migrations 0016–0019 and the access UI were applied
to staging on October 4. Staging now has eight
live committees, an isolated legacy row and four events, no active legacy
access, two migration revocation audits, and FORCE RLS. The old staging manager
Auth test confirms that the old account has no final committee scope. The
second migration adds a private Auth identity view because Supabase does not
retain schema `USAGE` for the custom routine owner. Production has now advanced
through 0019. Read-only checks found eight live committees, one isolated legacy
row, no active legacy grant, FORCE RLS on access/events/registrations, and
correct Technical, Board, Support-placeholder and no-role committee visibility
(8/8/0/0 after revocation).
The fresh production logical backup is stored outside the repository at
`%LOCALAPPDATA%\\engsoc-platform\\backups\\pre-access-2026-10-04.dump` (381,824
bytes). PostgreSQL 17 `pg_restore --list` found 523 archive entries, and a full
archive decode to `/dev/null` succeeded. The local migration rehearsal and
backup/restore test passed. Supabase reports WAL archiving but no listed physical
backup or PITR window; the logical archive is the confirmed recovery artifact.
Finance and Media addresses were not provisioned after the owner reserved
manager assignment for the Technical lead. No landing-page change has been made.
Production's five titles all begin `M8 release smoke`; all five remain archived,
and the four registrations use test-pattern email addresses. The controlled
archive is complete without deleting foreign-key-linked audit evidence.

See `docs/UC-02_Acceptance_and_Delivery.md` for release evidence and
`docs/UC-02_Deep_Dive.md` for the frozen behavior contract.

**HISTORICAL MILESTONE:** Finalize the access hierarchy and production pilot
before any landing-page migration. UC-02 M8 release history below is retained
as context; the old maintenance-only manager model is superseded by ADR 0012.

**SOURCE AND CHECKS:** The M8 integrity pass at `2fdc72f` delivered scoped
overview counts, bounded export, event editing guards, safe recovery guidance,
and cross-surface/revocation tests. The manager feedback fix at `0ad7809` keeps
edit and lifecycle success visible through refresh. Its local gates passed:
format, lint, typecheck, 120 tests, DB migration check, production build,
20 desktop/mobile browser tests and diff check. GitHub CI run `36765216880`
succeeded.

**STAGING:** Project `wnrdgnmmcdedmilnzzsl` has migration 0015 and
ENABLE/FORCE RLS on all ten UC-02 tables. A real `app_runtime` login could
call the scoped count routine and was denied direct event-table reads. The
deployed staging manager smoke passed counts, export, promotion, foreign-scope
denial, malformed cursor and mobile checks; its fixtures were removed.

**MAIN SECURITY AND BACKUP:** The owner selected original main project
`rbeyqrfypowyocmnmvwu`. Live inspection on September 24 corrected the stale
RLS preflight: all ten UC-02 tables had ENABLE/FORCE RLS. The prechange schema
and data dump restored in disposable Supabase Postgres 17.6; migrations
0007–0015 replayed on that restore and were then applied to main. Main routine
ownership, fixed search paths and restricted grants were checked. The owner
confirmed the first maintenance actor; the Events committee, manager grant and
matching audit row were created. Main Auth sign-in passed. The rotated main
`app_runtime` password supported a real scoped routine login while direct
event-table access was denied.

**SERVING DEPLOYMENT:** Vercel Production variables target main; unused
privileged variables and the temporary staging manager smoke variables were
removed. GitHub's Production deployment record links `0ad7809` to Vercel
deployment `dpl_4J2mcjwg8pQBDSejGqiJhXDR1Fto`, which reached Ready and
served the public alias during the main-project smoke.
The deployed main Auth session and full manager workflow passed: create,
review/self-approval denial, edit and success feedback, publish, public
confirmed/waitlisted/duplicate outcomes, scoped lists and CSV, archive,
restore and public hiding. Three synthetic events were archived; registration
and audit history is retained. The smoke harness's redundant cleanup check
failed after all workflow assertions, was corrected, and a separate read-only
archived-record verification exited successfully. Vercel's error log query
returned no errors for this deployment.

**NEXT EXACT TASK:** Have the named Technical and Board users sign in and verify
their live access. The owner must provide the real Support manager before the
manager pilot can run. The Technical lead will later create/select and assign
the Finance and Media managers through `/admin/access`; do not send invitations
or assign those roles on their behalf. Leave Forum, Evening, Relations and
Society Affairs managerless.

**PARALLEL INITIATIVE — DESIGN SYSTEM:** The owner separately authorized a
project-wide design-system pass (tokens, theming, component foundation,
restrained Canvas UI/GSAP on auth) on October 1, 2026. See
`docs/adr/0010-project-wide-design-system.md`. This is presentation-only and
does not change, weaken, or substitute for the UC-02 closure decision above —
it may land commits on `main` in the same window as this hold. See
`docs/DESIGN_SYSTEM.md` once written for the resulting conventions.
