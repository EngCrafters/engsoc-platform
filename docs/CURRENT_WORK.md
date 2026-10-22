# Current work - handoff state

**CURRENT — administration and permanent deletion (October 22, 2026, Muscat):** ADR 0024 and
forward migration `0032_administration` add a Society administration section for Board
Administration and the Technical Team: an overview and permission matrix, committees
(create, edit, archive, rosters, managers), members, and the accounts page opened to Board for
Committee Managers. Events, projects, membership records and (Technical only) whole accounts can
be deleted permanently after a preview, typed confirmation and, for people, password re-entry.
Audit rows are kept; erased accounts are pseudonymized. `npm run test:admin-flow` drives it in
the browser.

Staging was migrated to 0032 on October 22 with the owner's authorization. The rollout followed
the 0031 plan:

1. A schema comparison against a local replay and a rehearsal (25 of 25 checks).
2. A backup, then 0032 in one transaction, then post-flight checks (10 of 10, every existing row's
   fingerprint unchanged).
3. 12 of 12 end-to-end checks through the local dashboard with synthetic accounts, which were then
   removed back to the exact baseline.

Without `SUPABASE_SERVICE_ROLE_KEY` an account erasure stops at "pending" after removing the data,
by design; production needs that key for complete erasure. Production is untouched. Its database
must reach schema 32 before the release gate lets this code deploy.

**CURRENT — smart navbar and member profiles (October 21, 2026, Muscat):** ADR 0023 and forward
migration `0031_member_profiles` give members a real `/profile`. The website's navbar follows the
Supabase session: Join while signed out, and an avatar menu once signed in. An applicant gets the
menu without member privileges.

- **Edits.** Members edit their phone, year, discipline and interests, and upload or remove a
  photo. Photos are re-encoded into a new private bucket, `SUPABASE_S3_MEMBER_PHOTO_BUCKET`.
- **Corrections.** Name and student ID change only through a correction that a membership
  reviewer decides on the dashboard.
- **Feature switches.** `ESWebsite/config/site-features.json` now holds the page flags that
  `content/site.ts` reads, plus the profile switches. Core enforces its own matching
  `MEMBER_PHOTO_UPLOADS` and `MEMBER_PROFILE_EDITING`.
- **Verification.** `npm run test:profile-flow` drives register → confirm → pending → approved →
  profile → edit → photo → correction → refresh → sign out end to end on the local harness.

Staging was migrated to 0031 on October 22 with the owner's authorization. The rollout followed
the 0027–0030 plan:

1. A schema comparison against a local replay and a rehearsal (9 of 9 checks).
2. A backup, then 0031 in one transaction, then post-flight checks (7 of 7).
3. A new private `member-photos` bucket.
4. 13 of 13 end-to-end checks through the local apps with synthetic accounts, which were then
   removed back to the exact baseline counts.

Production is untouched. Deploying Core needs `SUPABASE_S3_MEMBER_PHOTO_BUCKET`. Nothing was
pushed or deployed.

**CURRENT — audit repairs (October 21, 2026, Muscat):** ADR 0022 and forward migration
`0030_attendance_reliability_and_limits` fix the audit's confirmed defects locally.

- **Check-in codes.** Codes are derived per minute in the database, so screens no longer
  invalidate each other, and each code works for three minutes.
- **Guest linking.** Guest registrations link to the member who confirmed that email.
- **Manual attendance.** Organizers record or undo it with fixed reasons, audited.
- **Rate limits.** Signed-in registration is limited per member, not per address. Guests and
  applications allow 20 per address, and old IP attempts are purged.
- **Release gate.** `npm run build` refuses, on Vercel production, a database older than the code
  or a privileged runtime role. `GET /v1/health` reports schema compatibility.
- **Diagnostics and descriptions.** Member API failures are logged with SQLSTATE only, and Core's
  public pages render description links safely.

Staging was migrated to 0030 on October 21 with the owner's authorization. The rollout covered a
backup, a rehearsal, post-flight checks, the image buckets, a rotated restricted runtime role and
16 of 16 end-to-end checks on staging (`docs/STAGING_ROLLOUT_0027_0030.md`). Production is
untouched: it needs the same plan, each step approved separately. Nothing was pushed or deployed.

**CURRENT — Projects and static page flags (October 21, 2026, Muscat):** The owner's
correction removes all unfinished dashboard/API/database page controls. ESWebsite's
existing `content/site.ts` is the sole developer-controlled flag list; Projects is
active and the other unfinished modules retain their original Coming Soon views.
ADR 0021 and `docs/api/PROJECTS.md` describe private member drafts/media, Society
Affairs/Board/Technical review, explicit approval/publication, retained public
snapshots during edits, private decision history and scoped authorization.
Forward migration `0029_member_projects` follows 0027/0028 and remains unapplied
to hosted environments. Disposable localhost migration tests were explicitly
approved. Deployment also needs a distinct private project bucket and restricted
runtime configuration. Existing branches, membership/event work and designs remain.
No push, merge, hosted mutation or deployment was performed.

**CURRENT — local event extension (October 21, 2026, Muscat):** The owner's event
handoff is implemented on the existing local feature branches, preserving the
membership commits. ADR 0020 and `docs/api/EVENT_ATTENDANCE.md` describe image
uploads, safe links, private phones, profile registration, and scoped QR attendance.
Local verification covers 558 Core tests, 97 website tests, both production builds,
45 existing browser tests (one intentional skip), and the two-app event workflow.
The event workflow uses real restricted PostgreSQL routines with synthetic local
Auth/Storage adapters; it is not hosted Supabase verification. Staging was inspected
read-only: its journal ends at 0026; 0027's function/column are absent. Apply neither
0027 nor new 0028 without approval. Deployment also needs a separate private event
bucket, matching website/CORS origins, and an `app_runtime` URL (the local configured
URL currently logs in as postgres). No push, deployment or hosted mutation occurred.
The dated handoffs below describe earlier releases.

**CURRENT — pre-domain functional verification complete (October 19, 2026, Dubai):** This note supersedes
the dated handoffs below. Work began at Core `15875f4`; the serving Core remains
`https://engsoc-platform.vercel.app`. ADR 0016 separates Landing from Core.
Core main `6e71995` passed GitHub CI `39160613952` and reached Vercel deployment
`https://engsoc-platform-59x8jkk42-eng-crafters.vercel.app`. Core deployment ID is `dpl_F5pTn1aWz6rudnq9nyTy5J9pgVeH`.
Staging includes runtime fixes `25c433d` and the CI-only
shared-fixture assertion correction `4ca9f82`.
The private GitHub repository `EngCrafters/essqu-web` preserves Landing source
`17bdcc4244f608a5b3ec8361db470ec1ae32a8c0` and is connected to the separate
Vercel project `essqu-web` (`prj_yXxcM8AlVAuARpepUJMUAo4N20AL`). GitHub reports
the `EngCrafters` namespace as type **User**, not Organization.

Staging `wnrdgnmmcdedmilnzzsl` has migration `0024_api_clients` applied through
Supabase MCP. Read-only invariants passed: forced RLS with the routine-owner
SELECT policy, runtime routine execution, no anon/authenticated/PUBLIC execution,
zero runtime table grants, and five existing registrations retained. Staging
clients and the restricted runtime are provisioned. Core and Landing serve their
explicit staging aliases. Full live run `7e31d8dd-bea1-4c25-9edc-6d83b93fc046`
passed read authentication/scope and exact DTO, visibility, precise upcoming/past
pagination, CORS and validation, all five conflict reasons, confirmed/waitlist and
duplicate outcomes, capacity-one concurrency (201/409, exactly one confirmed),
and real 429 with Retry-After 600. A real Landing browser registration returned
201 with credential-free exact payload, request-ID echo and no automatic retry.
Four anonymous success audit outcomes reconciled. Cleanup left zero fixtures and
retained the five existing staging registrations. Landing English/Arabic
desktop/mobile QA and CI passed.

Production `rbeyqrfypowyocmnmvwu` has migration `0024_api_clients`, version
`20261018200028` (October 18 UTC; completion October 19 Dubai), applied through
MCP after all seven prechecks and the successful live matrix. All eleven
application tables (ten prior plus registry) have forced RLS. The registry owner,
owner SELECT policy, verifier owner/SECURITY DEFINER/search path and execution
grants passed postflight. `app_runtime` has zero direct and effective table
privileges and is NOBYPASSRLS; anon/authenticated/PUBLIC cannot execute the verifier.
Seven registrations retained the exact pre/post fingerprint
`d6768a9e715e9e9fb4a43f63b5616214`; `register_for_event` retained fingerprint
`54ffeccd2ed187f21f420be46e95c17f`. Bogus API reads changed from 503 to 401.
Production client `ESSQU Landing Production` is active with production-only
`events:read`, installed as a Landing Production Secret. Live reads passed
401/403/200, existing public detail 200, and immediate canary revocation 401.
Landing production is Ready at `https://essqu-web.vercel.app`, deployment
`essqu-obivj77wp-eng-crafters.vercel.app`, merge
`8f5c0bffb0cf431c98777bc3d6111f014dd3db7b`, CI `39161420446` passed.
Landing deployment ID is `dpl_4Kj8rku9wS9iUUKdTwCHsaRcPU8M`.
Final actual-secret browser verification passed for English/Arabic on desktop/mobile: 16
main-route responses plus four details were 200; one upcoming/two past events,
correct direction and no overflow. The exact private key was compared in memory
against 358 loaded HTML/RSC/JS responses plus URLs/headers/storage/cookies with
zero violations; 20 canceled-prefetch bodies were separately unreadable, with no
pending scans. Four registration POSTs were aborted before network with exact
credential-free payload and request ID, generic failure guidance and no retry
within 1.2 seconds. No production registration was written. The real browser
confirmed-201 flow is proven on staging. The owner explicitly accepted the lack of a
verified managed backup **only for unchanged additive migration 0024**, after
successful live staging and concurrency checks. That prerequisite passed;
the waiver does not authorize other DDL, existing-row DML, a local dump/PII export,
a subscription upgrade or domain/Auth changes. The owner confirmed keeping
Landing under the GitHub User namespace `EngCrafters`.
The Supabase organization is Free; authenticated backup
inspection returned `backups: null`, empty `physical_backup_data`,
`pitr_enabled: false`, and `walg_enabled: true`. WAL archiving alone does not
establish a usable backup or restoration path. No backup is claimed. Production
0024 was applied under this narrow waiver; API-client provisioning is a separate
scoped operation, and no production attendee mutation was used for verification.

Independent review found 0024 byte-identical at `15875f4` and `1eac4db`:
SHA-256 `cab56a820213bf11bca3f72d0581ed3505b509de8886e66837446c81b5de5479`.
It creates only registry objects and touches no existing rows. Its final checks
cover only registry runtime table grants, runtime execution and PUBLIC execution;
pre/post checks must separately verify RLS, ownership, other execution grants and
existing data counts. The SQL has no explicit transaction wrapper; the completed
MCP application sent `BEGIN;`, the unchanged reviewed 0024 file, and `COMMIT;`
in one request, with no other DDL or migration. This makes atomicity explicit
without assuming undocumented backend transaction behavior.

Pre-domain functionality is complete. Fresh real-credential login/logout and
emailed recovery/reset were not repeated; existing leaked-password protection
and development-only advisory follow-ups remain deferred. No backup was created
and the waiver does not extend to future DDL.

Custom domains and DNS are untouched. Auth origins and host enforcement remain
unchanged. The current release checklist is
[CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md](api/CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md);
[PRODUCTION_CUTOVER_RUNBOOK.md](api/PRODUCTION_CUTOVER_RUNBOOK.md) retains the
production migration and credential procedure.

Final local gates for the updated runtime source passed: format, lint, migration
consistency, types, 421 unit/database tests across 44 files, and webpack build.
The browser suite passed 43 tests with one intentional skip against the updated
runtime source; the missing pinned Chromium executable was installed before that
successful rerun. Later script/test additions require their own relevant checks.
`npm audit --omit=dev --json` returned zero vulnerabilities on October 18.
The older disposable HTTP script produced expected diagnostics but uses a local
superuser and lacks assertions; it is not evidence of a hosted restricted-role run.

**FOCUSED PRODUCTION FIX (October 8, 2026):** CSV export investigation confirmed
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
No landing-page migration or broad UI redesign has started.

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
