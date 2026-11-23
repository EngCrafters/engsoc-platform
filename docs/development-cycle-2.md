# Development Cycle 2: expanded membership, SQU verification and committee leadership

The working summary for both repositories. The decisions and their reasons are in
[ADR 0025](adr/0025-expanded-membership-verification-and-leadership.md). The public website's
side is summarised in ESWebsite `docs/development-cycle-2.md`.

> **Later change (2026-11-22).** [ADR 0027](adr/0027-configurable-committee-and-team-permissions.md)
> replaces the fixed reviewer rules below with named permissions: SQU verification, leadership
> decisions and the settings belong to whoever holds `squ.review`, `leadership.review` and
> `settings.verification` (initially Board Administration and Society Affairs, and Technical for
> the settings), and approved Chiefs and Assistant Chiefs receive their committee's or team's
> permissions. The code now requires schema 36. See
> [Permissions and Email Centre](permissions-and-email-centre.md).

## Status

| Item                 | State                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code                 | Implemented locally in both repositories; **uncommitted, not pushed, not deployed**                                                                                                                                                                                                                             |
| Migrations           | `0033_membership_verification_leadership` and `0034_committee_leadership`, forward-only; **both applied to staging on 2026-11-20** (owner-authorized); production untouched                                                                                                                                     |
| Required schema      | 34 for this cycle; 36 since the permissions and Email Centre work (`/v1/health` and the release gate accept that version or later)                                                                                                                                                                              |
| New environment vars | None                                                                                                                                                                                                                                                                                                            |
| Verified             | Locally (disposable PostgreSQL 17, browser flows) and on staging (post-flight checks; a rolled-back behaviour check for 0034). See [Verification performed](#verification-performed)                                                                                                                            |
| Owner decisions open | Four, listed in [Open decisions](#open-decisions); the others were decided on 2026-11-19                                                                                                                                                                                                                        |
| Hosted staging       | Schema **34** since 2026-11-20 (history `20261120123119`), **36** since 2026-11-22 ([Permissions and Email Centre](permissions-and-email-centre.md#migration-status)); see [Staging application](#staging-application-2026-11-20) and [Committee-level leadership](#committee-level-leadership-0034-2026-11-20) |

## What changes for people

**Applicants (`/register` on the website).**

- Five categories: University Student, Graduate / Alumni, Academic / Researcher, Industry
  Professional, Other.
- University Students choose their university from a list kept in the database (SQU, UTAS,
  University of Nizwa, GUtech, Sohar University and other Omani universities) or "Other
  university" with a typed name. They also give an academic year (1–5).
- Graduates may add their alma mater. The other categories are asked for no institution and no
  year. Values typed for one category are cleared when the applicant switches category, and Core
  drops them again before storing anything.
- Any valid email address is accepted, personal or institutional.
- No student ID and no ID card are collected at registration. The agreement text (consent
  `2026-11-v2`) and the card preview no longer mention them.

**Members (`/profile`, two independent cards).** "SQU student verification" and "Committee
leadership" each load their own Core endpoint, with their own loading, error (with a request
reference and "Try again") and empty states. One failing never hides the other. The profile
header links to each card.

- **SQU student verification**, which is optional: the member submits their SQU student number and
  a photo or PDF of their SQU ID card, then sees one of these states:
  - pending;
  - verified, with an "SQU Verified" badge on the profile;
  - rejected, with the reviewer's reason;
  - revoked, with its reason.

  After a rejection or revocation they can submit again, within the resubmission limit.

- **Committee leadership**: the member chooses an active committee, a team in it and a position
  (Chief or Assistant Chief), then follows the request's status. An approved request is shown as
  "Committee → Team → Position". A member may hold positions in several teams, one per team.
  Holding a position grants no dashboard access, and the card says so.
- Decisions are shown on the profile only. No email is sent.

**Reviewers and administrators (Core dashboard).**

- `/admin/membership` has three tabs:
  - **Applications**, the existing flow, now showing the category and institution;
  - **SQU verification**;
  - **Leadership**.

  Each tab has search, a status filter, date filters and pagination. The Leadership tab also
  filters by committee and team. Pending counts appear on the tabs and the overview.

- SQU verification and leadership are reviewed by **Board Administration and Society Affairs**.
  Technical sees those two tabs as settings-only pages: access alone grants no review authority.
- On an SQU verification request, the reviewer:
  - views the evidence through an authenticated route, and each view is audited;
  - verifies or rejects it, giving a member-facing reason and an optional internal note;
  - can later revoke a verification.
- On a leadership request, the reviewer sees whether the position is vacant, then approves or
  rejects it.
- `/admin/administration/committees/<id>` gains **Teams and leadership**. There, Board and
  Technical can create, edit, move, deactivate, archive and delete teams. Board alone also
  assigns, changes and revokes appointments there (also on inactive teams, so they can be
  archived); Technical sees the leaders without those controls.
- Technical can change the verification settings on the membership page: resubmission limits,
  appointment limits, position limits and the evidence retention period.

## The five concepts stay separate

| Concept                    | Stored in                                                        | Granted by                              |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| Account                    | Supabase Auth                                                    | Sign-up and email confirmation          |
| Membership                 | `membership_applications` → `members`                            | Membership review (unchanged, ADR 0017) |
| SQU student verification   | `private.squ_verification_requests`, `private.squ_verifications` | Board Administration or Society Affairs |
| Organizational appointment | `private.leadership_requests`, `private.leadership_appointments` | Board Administration or Society Affairs |
| Dashboard access           | `public.administrative_access`                                   | `/admin/access` only                    |

None of them implies another:

- approving membership verifies nobody;
- verification does not change membership;
- no appointment writes `administrative_access`.

The database tests assert each of these.

## Permissions

| Action                                                | Who                                                                     | Enforced by                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Submit SQU evidence, request a position               | A signed-in **member** (an approved, activated membership)              | `submit_squ_verification`, `request_leadership`   |
| Review, verify, reject, revoke SQU verification       | Board Admin and the Society Affairs manager (not Technical)             | `private.verification_reviewer_kind`              |
| Approve or reject leadership requests                 | The same reviewers                                                      | `private.leadership_reviewer_kind`                |
| Create, edit, move, deactivate, archive, delete teams | Board Admin, Technical                                                  | `private.senior_admin_level`                      |
| Assign or change appointments directly                | Leadership reviewers (on the dashboard: Board, from the committee page) | `private.leadership_reviewer_kind`                |
| Revoke an appointment                                 | Leadership reviewers                                                    | `private.leadership_reviewer_kind`                |
| Change verification settings and position limits      | Technical                                                               | `set_verification_settings`, `set_position_limit` |
| Decide or revoke anything about oneself               | Nobody: refused as `SELF_REVIEW`                                        | Each decision routine                             |

Committee managers other than Society Affairs gain nothing in this cycle.

## Core changes

### Database: migration 0033

The migration is additive and forward-only. It does the following:

- Adds new tables, all in `private`, with FORCE RLS and `routine_owner` policies:
  - `membership_categories`, `institutions`;
  - `squ_verification_requests`, `squ_verification_documents`, `squ_verifications`;
  - `committee_teams`, `organizational_positions`;
  - `leadership_requests`, `leadership_appointments`;
  - `verification_settings`.
- Adds new columns:
  - `category`, `institution_id` and `institution_name` on `membership_applications` and `members`;
  - `university_id` becomes nullable on both tables, and `academic_year` on applications. Existing
    values are kept.
- Constraints and unique indexes enforce:
  - one pending SQU request and one active verification per member;
  - one active verification per student number;
  - one pending leadership request per member and team;
  - one active appointment per member and team (positions in several teams are allowed);
  - an institution **or** a typed name, never both.
- Backfills only addresses ending in `squ.edu.om`:
  - applications become `university_student` at `squ`;
  - members become `graduate` (if their status is graduate) or `university_student`, at `squ`.

  Nobody is marked SQU-verified.

- Seeds:
  - the categories, the Omani institutions, the `chief` and `assistant_chief` positions (one
    holder each per team);
  - the settings row: 3 SQU submissions and 5 leadership requests per 30 days, no cross-team
    appointment cap (`NULL`), retention `NULL`.

  It inserts **no committees or teams**.

- Adds the routines listed in [Core API and routines](#core-api-and-routines). They are SECURITY
  DEFINER, owned by `uc02_routine_owner`, and only `app_runtime` may execute them. Every decision
  writes an append-only `private.uc02_audit` row identifying the person by `memberId`.
- Replaces the following routines in place:
  - membership list and detail, which now return the category and institution;
  - own profile, which now returns the category, institution and `squVerified`;
  - member deletion and account erasure, which now also remove verification and leadership
    records;
  - committee archive, which now cancels pending requests and refuses while appointments are
    active;
  - the storage deletion key check, which now accepts `squ-verification/`.
- Keeps the 0025/0026 application routines callable, so the previous Core keeps working until the
  new one is deployed.

Rollback is not automatic. Before any write, restore from a backup. After writes, keep the schema:
the previous Core runs against it, because `/v1/health` accepts schema 33 or later and the old
routines remain.

### Core API and routines

| Route                         | Method | Purpose                                                                                           | Auth                       |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------- | -------------------------- |
| `/v1/membership-options`      | GET    | Categories (with what each collects), institutions, current consent version                       | Public, CORS, cached 5 min |
| `/v1/membership-applications` | POST   | Now takes `category`, `institutionId`, `institutionName`, optional `academicYear`; no ID, no file | Public, CORS, rate-limited |
| `/v1/me/profile`              | GET    | Adds `category`, `categoryLabel`, `institution`, `institutionName`, `squVerified`                 | Member bearer token        |
| `/v1/me/profile`              | PATCH  | Edits category, institution and year under the same rules as registration                         | Member bearer token        |
| `/v1/me/verification`         | GET    | Own SQU verification state only (number masked)                                                   | Member bearer token        |
| `/v1/me/leadership`           | GET    | Own appointments, requests, limits and `dashboardAccess` (reported, never granted)                | Member bearer token        |
| `/v1/me/verification/squ`     | POST   | Multipart `studentNumber` + `document`                                                            | Member bearer token        |
| `/v1/me/leadership/options`   | GET    | Active committees with active teams, requestable positions                                        | Member bearer token        |
| `/v1/me/leadership/requests`  | POST   | `{committeeId, teamId, position}`                                                                 | Member bearer token        |

Result codes map onto the existing problem types:

| Codes                                                                                                         | Problem type     |
| ------------------------------------------------------------------------------------------------------------- | ---------------- |
| `VALIDATION_ERROR`, `HIERARCHY_MISMATCH`                                                                      | `invalid-fields` |
| `RATE_LIMITED`                                                                                                | `rate-limited`   |
| `MEMBER_REQUIRED`                                                                                             | `forbidden`      |
| `ALREADY_PENDING`, `ALREADY_VERIFIED`, `ALREADY_APPOINTED`, `TEAM_INACTIVE`, `COMMITTEE_ARCHIVED`, `CONFLICT` | `conflict`       |

Member responses never include a reviewer note, a reviewer's identity, a document key or the
full student number. The number is masked to its last three digits.

**Release compatibility.** For one release, `POST /v1/membership-applications` also accepts the
previous website's form, which has no `category` and includes `universityId` and `idDocument`. Core
treats it as a University Student at SQU and discards the ID and the file without storing them.
Both consent versions, `2026-10-v1` and `2026-11-v2`, are accepted.

### Library and dashboard

- `lib/membership/`: options (`membershipOptions`, cached for 5 minutes), category-aware
  validation that drops fields the category does not collect, and the v2 submission. The ID-card
  upload at registration is removed.
- `lib/verification/`: one function per routine (`db.ts`); the member view and evidence
  submission (`member.ts`, begin → upload → submit); the reviewer side, including evidence reads
  with size and SHA-256 checks and the retention cleanup (`review.ts`); labels and types. See
  [`lib/verification/README.md`](../lib/verification/README.md).
- `lib/administration/teams.ts`: team and appointment management.
- Dashboard pages:
  - `app/admin/(protected)/membership/verifications/` and `.../leadership/`, each a list and a
    detail page;
  - the evidence route `verifications/[id]/document`;
  - `verification-settings.tsx`, for Technical only;
  - `committees/[id]/committee-teams.tsx` with `team-actions.ts`.
- Shared components: `membership-section-tabs`, `review-queue-controls`, `review-action-dialog`
  and `verification-badges`. Navigation and breadcrumbs now cover the new routes.

### Storage

SQU evidence uses the existing private membership bucket (`SUPABASE_S3_MEMBERSHIP_BUCKET`) under
`squ-verification/<uuid v4>.<ext>`.

- No public or signed URL is issued.
- Without Storage configured, the bytes are kept in PostgreSQL, as ADR 0018 allows.
- Unlike application ID cards, evidence is **kept after the decision**, because a verification can
  be revoked and re-examined.
- The retention cleanup does nothing until Technical sets a period (30–3,650 days). No existing
  document is deleted by this cycle.

## Website changes

These are in the ESWebsite repository; see its `docs/development-cycle-2.md`.

- `/register`:
  - reads the categories and institutions from `GET /v1/membership-options` on the server
    (cached five minutes when successful). Without them it cannot know which details to ask for,
    so instead of a half-built form it shows "The application form couldn’t be loaded" with
    "Try again", which reads the options again from the browser;
  - shows each category's fields and clears the others;
  - shows a new agreement and card preview.
- `/profile`:
  - About shows the category and institution, and the SQU Verified badge;
  - profile editing covers the category fields;
  - adds two independent cards, `SquVerificationCard.tsx` (`GET /v1/me/verification`) and
    `LeadershipCard.tsx` (`GET /v1/me/leadership`), called from the member's browser with their
    access token like the other member routes. A failed card shows Core's request reference.
- Sign-in, password reset and email change say "Email address" and accept any valid address.
- Full English and Arabic text, RTL layout, labelled controls, live status regions and phone
  layouts.

## Verification performed

Latest run: 2026-11-20, after the fixes of 2026-11-19, on disposable local data. Hosted systems
were used only for the staging migration and its read-only checks (see
[Staging application](#staging-application-2026-11-20)); no write was tested against staging or
production, and no real person was involved.

| Check                                                                        | Kind                                 | Result                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Core `npm run lint`, `npm run typecheck`, `npm run format:check`, `db:check` | Static                               | Pass                                                                      |
| Core `npm run test`                                                          | Unit (mocked) and database suites    | 697 passed, 3 skipped (S3 stand-in and staging suites that need services) |
| Core `tests/db/development-cycle-2.test.ts`                                  | Database, real restricted roles      | 24 passed                                                                 |
| Core `npm run build`                                                         | Build                                | Pass; `/v1/me/verification` and `/v1/me/leadership` listed                |
| Website `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`     | Static, unit (pure functions), build | Pass; 152 tests                                                           |
| Browser flows, both apps (Chrome)                                            | Browser, local database              | 7 passed: profile 2, admin 3, event 1, projects 1                         |

The database suite covers:

- the legacy backfill (SQU addresses only, nobody verified);
- independence of the five concepts, and of the two member routines;
- self-review and self-appointment refusal;
- Technical refused for SQU review, leadership decisions, appointments and revocation;
- concurrent approvals for one position (exactly one wins) and duplicate pending requests;
- positions in several teams allowed, a second position in one team refused, an optional total cap;
- the per-30-day limits, with structure-cancelled leadership requests not counted;
- structure changes cancelling requests and refusing archives;
- revocation history;
- disabled retention, then purge in batches once a period is set;
- erasure and deletion with accountability blocks.

### Browser flows

The flows run on Core's two-app harness (`tests/event-flow/setup.ts`). It provides:

- a fresh local database;
- Core and the website in development mode;
- synthetic Auth and S3 adapters;
- Chrome.

The spec `tests/profile-flow/verification-roles.spec.ts` checks, in one run:

1. registration as Industry Professional (fields of a previous category cleared), Graduate with a
   typed "Other university", Academic / Researcher and Other; the profile spec registers a
   University Student at SQU, so all five categories are covered. No application has a student
   ID or a document;
2. Board Administration creates a team (with an Arabic name) and sees "Appoint a leader";
   Technical sees the team without appointment controls, and settings-only SQU and leadership
   queues;
3. the two profile cards are independent: with the leadership routine's grant revoked, the
   leadership card shows its error and a reference that matches the request id in Core's log,
   while the SQU card works; after the grant is restored, Try again loads the empty state and
   "Dashboard access: None";
4. the member submits SQU evidence (the number validated first) and requests Chief; changing
   the committee resets and disables the team;
5. Society Affairs opens the evidence (a decoded image) and rejects it with a reason;
6. the evidence route answers 401 without a session, 404 to Technical and 200 `no-store` to the
   reviewer;
7. the member sees the reason and resubmits;
8. Board Administration verifies the resubmission; Society Affairs approves the position;
9. the member sees the SQU Verified badge and "Media Committee → team → Chief", dashboard access
   stays "None", and there is no `administrative_access` row; Board's committee page lists the
   holder with Revoke, Technical's without;
10. Society Affairs revokes the verification with a reason the member sees; the audit trail lists,
    in order: submitted, requested, document viewed, rejected, document viewed, submitted, document
    viewed, approved, leadership approved, revoked;
11. Arabic: right to left, both card headings, and no horizontal scroll at 390 px on `/profile`
    and `/register`.

The profile, admin, event and project specs cover sign-in, profile editing, photos, corrections,
event registration and the dashboard.

**Defects these runs found, now fixed:**

- The SQU and leadership review pages passed icon components from a server page to the client
  dialog, so the pages failed to render. The dialog now takes a rendered icon element.
- The profile's hidden SQU file input was 390 px wide, because the field input rule applied to it.
  This caused horizontal scrolling at phone width. File inputs are now excluded from that rule.
- (2026-11-19) The committee page hid Revoke on inactive teams, so a team with leaders could not
  be archived from the dashboard. Revoke now shows on inactive teams too.

## Local development against staging

On 2026-11-19 the local setup ran Core on `http://localhost:3000` and the website on
`http://localhost:3001`, both configured for the **staging** Supabase project, consistently
(same URL and anon key; `CORE_API_BASE_URL=http://localhost:3000/v1`;
`CORE_API_ALLOWED_ORIGINS=http://localhost:3001`). That staging database is at schema 32, so the
31 routines this cycle adds do not exist there:

- `GET /v1/health` answers 503 `{"status":"schema-behind"}`;
- `GET /v1/membership-options`, `/v1/me/verification` and `/v1/me/leadership` answer 503
  `service-unavailable`. Core's log shows `membership_options_failed`,
  `member_verification_failed` or `member_leadership_failed` with `code: '42883'` and
  `schemaMismatch: true`;
- registration and profile editing also need 0033 (`submit_membership_application_v2`,
  `update_own_profile_v2`).

That was the cause of the half-built `/register` and of "Your verification and roles could not be
loaded right now". The website now shows those failures plainly, with retry. The environment fix,
applying 0033 to staging, was made on 2026-11-20 with the owner's authorization (see below).
Restart both dev servers afterwards. The isolated stack remains the way to test without any
hosted project:

```bash
# a fresh, empty loopback database whose name contains uc02_test, then:
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:<port>/uc02_test npm run local:stack
```

It serves the website on `http://127.0.0.1:3601`, the dashboard on
`http://127.0.0.1:3600/admin/login` and synthetic Auth and Storage on `127.0.0.1:3602`, with
synthetic accounts (listed when it starts). See
[Getting started](onboarding/getting-started.md#isolated-local-stack).

## Staging application (2026-11-20)

The owner authorized applying 0033 to the database the local apps use, the staging project
(`wnrdgnmmcdedmilnzzsl`). It followed [Migrations](how-to/migrations.md#applying-a-migration-to-a-hosted-environment):

1. **Read-only inspection:** PostgreSQL 17.6, schema 32, history ending at `0032_administration`,
   24 tables and 131 rows. A schema comparison with a local replay of 0000–0032 found no drift
   (18 event functions differ only by carriage returns; `auth.users.email` is `varchar` on
   Supabase).
2. **Rehearsal** on that replay with the same runner: apply, a refused second apply, the
   rollback (schema then identical to the 0032 replay, function bodies and grants included), and
   apply again.
3. **Backup:** `pg_dump` was not available on the machine, and running downloaded PostgreSQL
   binaries was not permitted, so the backup is a logical export taken with the repository's
   driver in one repeatable-read snapshot: every row of the 26 tables (`public`, `private`,
   `supabase_migrations`, `storage.buckets`; 168 rows) as JSON, every definition in `public` and
   `private`, a manifest with SHA-256 checksums, and `rollback-0033.sql` generated from
   staging's own pre-0033 definitions and rehearsed as above. It is stored outside the
   repositories and outside OneDrive (`C:Users<owner>essqu-backupsstaging-pre-0033-20261120-143247`)
   because it contains personal data.
4. **Apply:** the unchanged file (SHA-256 `a7d33da3…67e3`) and its history row in one
   transaction, with a 15 s lock timeout; committed in 5.6 s. The migration's own self-check passed.
5. **Post-flight (12 of 12):** schema 33 and the history row; nobody SQU-verified; forced RLS on
   every private table and no runtime or browser table access; routine owners and grants; the
   default settings; no teams inserted; every pre-existing row unchanged over its pre-0033
   columns; both SQU-address records categorised; all 118 routines Core calls present (also
   confirmed as `app_runtime`).

A fresh Core against staging then answered `/v1/health` `ok` and `/v1/membership-options` with the
five categories and 11 institutions. A Core dev server that was already running at the time kept
hanging on database routes until restarted (its single pooled connection, `max: 1`, had stalled;
the cause, found and fixed on 2026-11-22, was pipelined queries through the transaction pooler:
[Known gaps](known-gaps.md), item 16).

## Committee-level leadership (0034, 2026-11-20)

The owner's request "Fix the Committee Leadership workflow" found two problems: the profile only
offered committees that had teams (staging had none, so nobody could request anything), and
there was no visible place to manage leadership requests. [ADR 0026](adr/0026-committee-level-leadership-and-request-switch.md)
and migration `0034_committee_leadership` fix the model; 0033 is unchanged.

**Model.** A request or appointment belongs to a committee, and to a team only for team
leadership: "Support & Logistics Committee → Chief", "Support & Logistics Committee → Technical
Team → Chief", "Society Affairs Committee → Assistant Chief". No dummy team. One active Chief and
one active Assistant Chief per scope (the committee itself, or one team), one position per member
per scope, one pending request per member per scope, enforced by unique indexes that work without
a team and by the organization lock for concurrent approvals.

**Member (website `/profile`, Committee leadership card).** A visible **Request a leadership
position** button opens: Committee (required) → Assignment level (Committee leadership, or Team
leadership only when the committee has active teams) → Team (team leadership only) → Position.
Changing the committee clears the level and team; changing the level clears the team. While
requests are closed, the card says so; positions and requests stay visible.

**Administrators (Core dashboard).**

- **Enable or disable requests:** sidebar **Membership → Leadership**
  (`/admin/membership/leadership`), first card **Leadership requests**, switch **Accept new
  leadership requests**. Board Administration and Technical change it; Society Affairs sees it.
  Closing never hides appointments or pending requests, which stay decidable.
- **Review:** the same page lists committee-level ("Committee → Position") and team-level requests;
  each opens to approve, reject with a reason, or revoke.
- **Committee management:** `/admin/administration/committees/<id>` now has **Committee leaders**
  (the committee's own Chief and Assistant Chief, appoint, change, revoke, link to pending
  requests) separate from **Teams and team leaders**.

Unchanged: leadership reviewers are Board Administration and Society Affairs; Technical manages
teams and settings but neither reviews nor appoints; nobody decides or appoints themselves; no
title grants dashboard access.

**Applied to staging** on 2026-11-20 with the owner's authorization, following
[Migrations](how-to/migrations.md#migration-0034-committee-level-leadership-adr-0026): read-only
inspection (no drift from the 0033 replay), rehearsal of apply, rollback (schema identical) and
re-apply, a logical backup with a generated rollback script
(`C:Users<owner>essqu-backupsstaging-pre-0034-20261120-163020`), then the unchanged file in one
transaction (4.6 s, SHA-256 `40193dae…1fea`, history `20261120123119`). Post-flight 11 of 11. A
behaviour check **on staging itself** ran inside one transaction that was rolled back: 25 of 25,
including a committee with no teams, both levels in one committee, the switch (Society Affairs
refused, Board closes, new requests refused, pending still approved, Technical reopens), one
Chief per committee, rejection reasons, Technical unable to appoint, no self-appointment, archive
refused while committee leaders remain, revocation with a reason; afterwards no synthetic record
remained. A fresh Core against staging then answered `/v1/health` `ok` (schema 34).

## Policy review (2026-11-19)

Decided and implemented in 0033:

| Policy        | Rule now                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positions     | One active Chief and one active Assistant Chief per team; positions in different teams allowed; never both positions in one team; concurrent approvals serialized (one wins), duplicates refused                                      |
| Resubmissions | SQU: 3 stored submissions per 30 days, so two corrections after rejections; one pending at a time. A refused or failed upload writes nothing and does not count. Leadership: 5 per 30 days, not counting structure-cancelled requests |
| Reviewers     | Board Administration and Society Affairs review SQU evidence and decide leadership. Technical manages teams and settings but reviews neither                                                                                          |
| Notifications | Decisions always appear on the profile cards with their reasons. That is the only supported channel today                                                                                                                             |
| Privacy       | Evidence, full student numbers and reviewer notes stay in reviewer-only routines; member responses mask the number and omit notes and reviewers                                                                                       |

## Open decisions

The owner should decide these before release.

1. **Evidence retention.** Recommended: 365 days after the decision, then Technical sets
   `document_retention_days` = 365 in the settings. Until a period is approved it stays `NULL`
   and nothing is deleted.
2. **Technical as an application reviewer** (ADR 0017 open decision 5). Applications still include
   Technical; aligning them with the rule above means changing `private.membership_reviewer_kind`
   in a later migration, and moving the approval-policy form for Technical.
3. **Decision emails.** Missing dependencies: a transactional email provider configured for Core
   (no code reads `RESEND_API_KEY` today), a verified sending domain and approved wording in both
   languages. Supabase Auth's SMTP sends only its own account emails.
4. **University privacy approval** for collecting SQU student numbers and ID images for
   verification.

## Release steps

Step 2 was carried out for staging on 2026-11-20 (see
[Staging application](#staging-application-2026-11-20)). The others have not been. Each needs the
owner's approval.

1. Review and commit both repositories on a branch, then open pull requests. CI runs the same
   checks as above.
2. **Staging database:** follow
   [Applying a migration to a hosted environment](how-to/migrations.md#applying-a-migration-to-a-hosted-environment)
   for `0033_membership_verification_leadership.sql`, after confirming the target is at 32:
   1. inspect read-only;
   2. take a `pg_dump` and verify it with `pg_restore --list`;
   3. apply the file in one transaction (its self-check raises on any problem);
   4. post-flight: `select private.core_schema_version()` returns 33, and `select count(*) from
private.squ_verifications` returns 0.

   `npm run db:migrate` writes to whatever `DATABASE_URL` points at. Confirm the target before
   using it. Any staging write needs the owner's approval.

3. **Deploy Core to staging, before the website.** The previous website keeps working, because
   Core accepts its form for one release.
4. **Deploy the website to staging.** Then check, with synthetic accounts:
   - non-SQU registration;
   - an SQU verification submitted, approved, rejected and revoked;
   - a leadership request approved;
   - team management;
   - Arabic, and a phone-width layout.
5. Repeat steps 2–4 in production, in the same order: database, Core, website.
6. After one release, remove the legacy form handling in
   `app/v1/membership-applications/route.ts` and the 0025/0026 submission routines in a later
   migration.
