# UC-02 M8 release notes — pending production gate

September 24, 2026. This is a release candidate, not a completed UC-02
release. The owner selected the original main Supabase project for production.
It is active and has the delivered migrations and RLS hardening. Vercel
Production still targets staging while initial main-project manager
provisioning and deployed smoke are outstanding.

## Manager operations

Committee managers can create, edit, review, approve, publish, mark full,
reopen, archive and restore events under the frozen lifecycle guards. They can
view event-scoped confirmed/waitlisted registrations, promote the first
waitlisted attendee after contact confirmation, and export a bounded CSV.
Archive/restore preserves the event, registrations and audit history. Hard
delete, registration cancellation, arbitrary status editing and attendance
editing are intentionally outside the frozen UC-02 contract.

The overview counts every record in the selected committee scope from the
database, independent of the current list page. Export refuses partial and
oversized results. Archived events are visibly read-only until restoration;
past date/capacity fields are locked; reviewed edits warn that a changed
revision clears approval. The manager error mapping and recovery-link flow
provide safe, specific guidance without database details.

## Remaining release evidence

- Verify production `app_runtime` with a real login; catalog checks are complete,
  but its existing password is unavailable in this workspace.
- Provision the first main-project manager and committee through the documented
  maintenance authority, then switch Vercel Production from staging to main.
- Verify the Ready deployment corresponds to pushed `main` with Vercel CLI.
- Supply named staging manager smoke credentials in ignored local environment
  configuration, then rerun the deployed authenticated browser matrix.
- Record final validation, CI, Vercel, restore and smoke evidence; only then
  mark M8 delivered and UC-02 complete.

## Verified release-candidate checks

Commit `2fdc72f` is on `main`. Format, lint, typecheck, 120 unit/database
tests, DB check, production build, 20 desktop/mobile browser tests and diff
check passed. GitHub CI run `36026002317` succeeded. Vercel deployment
`dpl_GsmSjpL8MLmpGvcJvwNR5HJEKwYE` is Ready on the public alias. Main has
ENABLE/FORCE RLS on all ten UC-02 tables and migrations through 0015. The
main schema and data were backed up before the migration, and an isolated
PostgreSQL 17 restore test passed. A real staging `app_runtime` role check
passed. Production is still backed by staging; the first main manager and
credentials are required before the serving environment can switch safely.

The actual prechange main dump was also restored in disposable Supabase
Postgres 17.6, and migrations 0007–0015 replayed on it successfully. A real
isolated runtime login was allowed to call the scoped count routine and denied
direct event-table reads. The deployed staging manager browser smoke completed
with the finalized existing credentials injected through Vercel CLI; fixture
cleanup was verified. The first main grant still needs an authorized
maintenance actor for its audit attribution before the production environment
can be changed.
