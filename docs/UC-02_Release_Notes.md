# UC-02 M8 production release — closure handoff pending

September 30, 2026. The owner selected the original main Supabase project
`rbeyqrfypowyocmnmvwu` for production. It is active, migrated through 0015,
and has ENABLE/FORCE RLS on all ten UC-02 tables. The first manager and Events
committee grant are provisioned. Vercel Production variables point to main,
and the deployed application at `0ad7809` passed the full main-project manager
workflow. Temporary smoke credentials were removed from Vercel Production.
UC-02 closure awaits the owner's explicit choice of the next use case.

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

## Remaining handoff decision

The next use case must be chosen explicitly before UC-02 closure. No choice
has been recorded; the project remains on UC-02 maintenance until then.

## Verified release checks

The M8 source pass at `2fdc72f` passed format, lint, typecheck, 120
unit/database tests, migration check, production build, 20 desktop/mobile
browser tests and diff check. GitHub CI run `36026002317` succeeded. The same
gates passed locally for the later manager-feedback fix at `0ad7809`; GitHub
CI run `36765216880` succeeded. GitHub's Production deployment record links
that SHA to Vercel deployment `dpl_4J2mcjwg8pQBDSejGqiJhXDR1Fto`, which
reached Ready and served `https://engsoc-platform.vercel.app` during the
main-project smoke.

The actual prechange main dump was restored in disposable Supabase Postgres
17.6, and migrations 0007–0015 replayed successfully. A real isolated
`app_runtime` login called the scoped count routine and was denied direct
event-table reads. After the owner named the first maintenance actor, main Auth
sign-in and a live main `app_runtime` login passed. The Events committee,
active manager grant and grant audit row were verified. The deployed staging
manager browser smoke completed its workflow and security matrix with fixture
cleanup.

The first main-project browser pass exposed an edit confirmation that
disappeared on refresh. Event edits and lifecycle changes now use a short
success toast, both observed on the deployed site. The main Auth session uses
the selected project. The deployed manager workflow then passed draft creation,
review flag and self-approval denial, review removal, edit, publication,
confirmed registration, explicit waitlist, duplicate denial, scoped list and
CSV export, archive, restore, and public hiding. Three synthetic test events
were archived after their starts; their registration and audit history remains.
The final workflow process exited with a test-harness cleanup error after all
functional assertions passed: it looked for an Archive button on an already
archived event. The idempotent cleanup check was corrected, and a separate
read-only verification exited successfully, confirming that event's manager
record remains archived and its public page contains no test title.

Next.js returned a streamed 404 page with no event details or registration
control for archived events; its HTTP response status was 200, as documented
for streamed `notFound()` responses. The page included a noindex marker.
Production environment inspection after the smoke found no
`STAGING_M5_MANAGER_EMAIL` or `STAGING_M5_MANAGER_PASSWORD`; the runtime URL,
public Supabase URL/key, Auth origin and Resend key remained configured.
