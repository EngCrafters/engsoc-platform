# Current work — handoff state

**CURRENT (October 7, 2026):** The remaining readiness checks are recorded in
`HARDENING_AUDIT_2026-10-07.md`; landing-page migration remains on hold for the
owner's completed recovery test and real Board/Support sign-in pilot. Technical
sign-in and screens are verified. The exposed migration credential was actually
**production**, not staging: it has been rotated, the old password rejected,
local/Vercel Development stores updated, and unused Preview storage removed.
Live production migrations through 0022, RLS, grants, routine bodies, and data
integrity have been inspected. No corrective migration or data deletion was
needed. A fresh database archive restored successfully in isolation.

Resend SMTP, verified sending domain/SPF/DKIM, inbox receipt, and delivery event
are now independently verified. Auth enforces the existing 12-character password
minimum. Leaked-password protection requires a paid plan (HTTP 402); PITR is
disabled with no listed physical restore window. Both are documented follow-ups,
not claimed capabilities. Vercel connector 403 is a team authorization limitation;
the separately authenticated CLI can read production logs. Auth Admin partial
success now reports failed audit recording and uncertain access assignment safely.
Local validation: 214 tests, 37 Playwright passes and one intentional skip;
format/lint/types/migration check/build/diff gates are recorded in the audit.

Commit `f374255` is pushed; GitHub CI `37578700777` is green, Vercel production
`dpl_GB1TEMC6rfVcqLkeh6DrKJxyC12N` is READY on that SHA, and production smoke
checks pass. The remaining hold is only the owner recovery and Board/Support
interactive checks listed in the audit. The isolated restore container and
temporary credential helper were cleaned up; the private backup was retained.

Current authority remains ADR 0012 and `docs/ACCESS_CONTROL.md`: Technical owns
application access, Board has global operational access, and each Committee
Manager has exactly one committee. The entries below are dated historical
handoffs; their open-item statements are superseded by this note.

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
