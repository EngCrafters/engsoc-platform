# ADR 0021: Website pages and reviewed member projects

Accepted for local implementation by the owner's October 21, 2026 request.
This explicitly extends the current event/membership work to Projects (UC-05).
Keep the existing branches/history and designs; no hosted mutation or deployment.

## Data contract

`private.website_pages` stores the five existing Coming Soon-capable page IDs,
state, revision, updater and timestamp. Projects starts active after rollout;
registration stays active; members, network and certificates stay Coming Soon.
The latter three remain activation-locked: their current content is a prototype.
Board/Technical can change ready pages, with optimistic concurrency and audit.
No arbitrary routes, HTML, scripts, URLs or client-supplied readiness flags.

`private.projects` belongs to one existing active Member and the existing
Society Affairs committee. It stores bounded validated bilingual JSON matching
the existing Projects design: title, summary, discipline, year, type, stage,
technologies, problem, solution, technical approach/decisions, milestones,
validation, next steps, collaboration, parts, achievements, team credits and
HTTP(S) links. Optional Arabic falls back to the supplied English. No sample
projects, procedural models or fabricated achievements enter the live catalogue.
Uploaded JPEG/PNG media is independently recorded in `private.project_media`.
It is decoded, re-encoded and stripped of metadata by the existing safe image
processor, stored in a separate private project bucket, and attached only by
an owner-authorized server routine. Maximum six images, 3 MiB each.

Working content, revision and review status are separate from an immutable
published content/media snapshot. Draft -> pending_review -> approved/rejected/
changes_requested; only explicit publication of the current approved revision
changes the public snapshot. Pending/approved revisions cannot be edited. Editing
after a decision starts a new draft without replacing the prior public version.
Unpublish removes public visibility immediately. No hard delete of project history.
`private.project_history` records every transition, revision, actor and feedback.
It is also the durable in-account decision notification, polled by My Projects.
There is no supported domain email sender/outbox today; do not invent or claim
email delivery or send messages externally during implementation.

## Authorization and publication

Only confirmed Auth identities with an existing `members.status = member` record
may create/edit/submit their own projects. This reuses 0027 activation, without
inserting accounts or changing membership. Graduates are outside the requested
active-member submission scope. Existing historical Member records stay valid.
Member identity comes from the verified JWT, never a body field. A reviewer is
the Society Affairs manager or existing Board/Technical, checked and locked in
Postgres on every request. Other managers cannot list, inspect, review or edit.
No reviewer edits member content. The author and any explicitly linked team
member cannot approve their project; reviewers attest no contributor conflict.
Team credit names confer neither account access nor verified membership.
Feedback is mandatory for rejection/changes requested. All writes use expected
revision, row locks and bounded input. Reviewer decisions are retained for the
member, including when a later revision exists.

All four tables have ENABLE/FORCE RLS, no browser or runtime table grants, and
only the existing NOLOGIN routine owner has table policies. Fixed security-definer
routines expose least-data public projections, own-member records or reviewer
scope. Public endpoints return published snapshots only and respect the Projects
page switch. Media requires current ownership/reviewer scope or membership in
the published snapshot; storage credentials and object paths remain server-only.
Raw anon/authenticated roles cannot execute actor-parameter routines.

## Integration and freshness

Core `/v1/website/pages` and `/v1/projects` are public, read-only projections with
no-store headers. No privileged client key is needed to read deliberately public
content. ESWebsite uses bounded no-store server reads, React request memoization
only, and disables link prefetch for managed pages; My Projects polls while open.
Admin mutations call revalidatePath for dashboard reads. Navigation indicators
share the same page state. Next navigation/refocus refresh handles browser state;
every new request observes the stored setting without a redeployment. Missing
Core settings fail closed to Coming Soon, never expose prototypes or sample data.

Migration 0029 follows 0027/0028, which remain subject to separate rollout approval.
Provision `SUPABASE_S3_PROJECT_BUCKET` distinct from membership/event buckets;
reuse existing Auth, CORS origins, S3 signer and restricted app_runtime connection.
Acceptance covers real restricted roles, stale/concurrent transitions, self/wrong
committee denials, snapshot isolation, media privacy, bilingual/mobile UI and
the two-repository browser workflow in a disposable local environment.
