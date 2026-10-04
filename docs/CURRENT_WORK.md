# Current work — handoff state

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
`6839336389` reached success. The existing robot/auth UI was left intact.
Technical and Board access rows are active and audited. The placeholder Support
grant was revoked immediately after clarification; RLS now gives it zero
visible committees, and `manager.revoked` records both states. Invitations had
already been sent to Technical and the Support placeholder; the latter cannot
access administration even if the invitation is accepted. Board Auth already
existed. Finance and Media accounts were not created or assigned. Human sign-in
verification for Technical and Board is pending; the manager pilot needs the
real Support identity from the owner.
Migration 0020 is prepared for the post-pilot controlled archive of the five
confirmed M8 smoke records. The archive path passed local backup/restore tests;
staging's four active non-smoke `Events` records were correctly left untouched.
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
Production's five titles all begin `M8 release smoke`; all five are archived,
and the four registrations use test-pattern email addresses. Cleanup still
waits for the reviewed, backed-up post-pilot procedure in ACCESS_CONTROL.md.

See `docs/UC-02_Acceptance_and_Delivery.md` for release evidence and
`docs/UC-02_Deep_Dive.md` for the frozen behavior contract.

**CURRENT MILESTONE:** Finalize the access hierarchy and production pilot
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
or assign those roles on their behalf. After the pilot, apply the prepared 0020
legacy archive and verify its audit. Leave Forum, Evening, Relations and Society
Affairs managerless.

**PARALLEL INITIATIVE — DESIGN SYSTEM:** The owner separately authorized a
project-wide design-system pass (tokens, theming, component foundation,
restrained Canvas UI/GSAP on auth) on October 1, 2026. See
`docs/adr/0010-project-wide-design-system.md`. This is presentation-only and
does not change, weaken, or substitute for the UC-02 closure decision above —
it may land commits on `main` in the same window as this hold. See
`docs/DESIGN_SYSTEM.md` once written for the resulting conventions.
