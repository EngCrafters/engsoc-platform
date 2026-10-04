# Current work — handoff state

**ACCESS HIERARCHY INITIATIVE (October 4, 2026):** The owner has explicitly
authorized finalizing application access before any landing-page migration.
Draft [ADR 0012](adr/0012-application-access-hierarchy.md) and
[ACCESS_CONTROL.md](ACCESS_CONTROL.md) record the three levels, single-committee
manager rule, eight-committee catalog, audit and rollout gates. Production
read-only inspection found one `Events` committee with five archived M8 smoke
events and one active manager; staging has the same committee ID, four events
and two active managers. Both projects are PostgreSQL 17 with UC-02 migrations
through 0015 and FORCE RLS on the relevant tables. The owner decided to keep
`Events` isolated as legacy smoke data and to allow a different Board or
Technical actor to review. Real production identities are required before the
pilot. No new access migration or
landing-page change has been applied.

See `docs/UC-02_Acceptance_and_Delivery.md` for release evidence and
`docs/UC-02_Deep_Dive.md` for the frozen behavior contract.

**CURRENT MILESTONE:** UC-02 M8 production release checks passed. UC-02 closure
awaits an explicit owner choice of the next use case. M7 was delivered on
September 23, 2026. Do not start another use case before that choice.

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

**NEXT EXACT TASK:** The owner must choose the next use case explicitly so
UC-02 can close. Until then, maintain UC-02 without starting another milestone.
For every later push, continue verifying GitHub CI and the serving Vercel
deployment.

**PARALLEL INITIATIVE — DESIGN SYSTEM:** The owner separately authorized a
project-wide design-system pass (tokens, theming, component foundation,
restrained Canvas UI/GSAP on auth) on October 1, 2026. See
`docs/adr/0010-project-wide-design-system.md`. This is presentation-only and
does not change, weaken, or substitute for the UC-02 closure decision above —
it may land commits on `main` in the same window as this hold. See
`docs/DESIGN_SYSTEM.md` once written for the resulting conventions.
