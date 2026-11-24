# Permissions, verification settings and the Email Centre

Owner request of 2026-11-22: configurable committee and team permissions, editable verification
and leadership settings, and a filtered Email Centre, across Core and the public website.

- Decisions: [ADR 0027](adr/0027-configurable-committee-and-team-permissions.md) (permissions)
  and [ADR 0028](adr/0028-email-centre.md) (Email Centre).
- Migrations: `0035_configurable_permissions` and `0036_email_centre`.
- Reference: [Roles and permissions](reference/roles-and-permissions.md),
  [Dashboard](reference/dashboard.md), [Configuration](reference/configuration.md),
  [Email Centre: going live](how-to/email-centre.md).

Status: implemented and verified locally; both migrations **applied to the hosted
development/staging database on 2026-11-22** with the owner's authorization
([Migration status](#migration-status)). **Not committed, pushed or deployed**; production is
untouched.

## What changed

### Permissions (ADR 0027)

- Every protected operation needs a named permission. There are 34, in seven areas (events,
  registrations, projects, membership, verification and leadership, organization and settings,
  accounts and communications). Each is granted **society-wide** or for **own committee**.
- **Every committee and every team has its own configuration.** A team does not inherit its
  committee's permissions.
- **Approved, active Chiefs and Assistant Chiefs receive their group's permissions**: a
  committee-level appointment receives the committee's, a team appointment the team's. A
  team's own-committee scope means its committee. Pending requests, roster membership, names,
  emails and titles grant nothing. Several appointments combine, each keeping its own scope.
  Revoking or ending an appointment, deactivating a team or archiving a committee removes the
  access on the next request.
- **No ceiling.** Any combination may be granted, including every permission society-wide
  ("full access"), which is the same as Board or more.
- **Personal levels keep their meaning** through a fixed mapping in the database
  (`private.access_level_permissions`), so nobody lost access:

  | Level             | Includes                                                                                                                                                                                |
  | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Technical         | Everything except SQU verification, leadership and the Email Centre (as before)                                                                                                         |
  | Board             | Everything except administrator levels, credentials and erasure (the membership settings since migration 0039). **New:** manage permissions, verification settings and the Email Centre |
  | Committee Manager | View, create, edit and publish events and manage registrations, for their own committee (as before)                                                                                     |

  A Committee Manager also receives their committee's configuration. Society Affairs' former
  slug-based authority is now its seeded configuration (11 permissions: view and review
  applications; view and review SQU verification; view, decide and assign leadership; view,
  review and publish projects; verification settings), so its Committee Manager keeps the same
  access and gains the verification settings. Changing what a level includes needs a new
  migration.

- **Enforced everywhere**: the sidebar, every page and server action, the API routes, and every
  database routine (`private.has_permission` and its scoped forms). No Board-only check remains;
  the migration's self-check fails if any routine still tests the Board level directly.
- **Safeguards**: since migration 0040 (ADR 0031) holders of `permissions.manage` may also edit
  the groups they hold access through (audited with `ownGroup: true`); an outdated editor is
  refused; changes that grant full access or touch permission management need confirmation; any
  change that would leave no active account able to manage both permissions and administrator
  access society-wide is refused (`LAST_RECOVERY_ACCOUNT`), whether it comes from a permission
  change, access revocation, suspension, appointment revocation, team deactivation or member
  deletion. Every change is audited (`permissions.changed`) with the previous and new
  permissions.
- **Wording**: the dashboard's account page and settings dialog list what the person can do and
  where it comes from (level or appointment). The website's leadership card says whether each
  position gives dashboard access, instead of "a position never grants access".

### Verification and leadership settings

On **Membership → Leadership**, holders of `settings.verification` (initially Board, Technical
and Society Affairs) edit:

- SQU verification and leadership requests allowed per member per 30 days;
- how long SQU verification evidence is kept after a decision;
- the maximum active appointments per member;
- Chief and Assistant Chief limits per committee (new) and per team;
- whether leadership requests are open.

An empty limit means **unlimited**; an empty retention period means **not configured** (evidence
is kept). **Zero is refused** with a message, so it can never be mistaken for either; the request
limits are required (1–20 and 1–50), and leadership requests are stopped with the switch instead.
Values are validated, every change is audited, and shortening the retention period shows how many
documents become due and asks for confirmation before saving. Nothing is deleted by the change
itself: the existing cleanup removes due evidence later, as before. Lowering a limit never ends an
appointment.

### Email Centre (ADR 0028)

At **Communications → Email Centre**, holders of `email.send` (initially Board only; assign it to
other committees or teams on the Permissions page):

- build an audience from filters: category, institution, academic year, discipline, interests,
  membership status, SQU verification, leadership position, committee (optionally one team), and
  individual include or exclude. Filters combine with AND, choices within one filter with OR,
  everyone is counted once, and the default is every active member. Recipients come from the
  whole society, not only the sender's committee;
- see the exact count and a searchable, paginated preview, computed in the database;
- write an English, Arabic or bilingual message in a safe formatting language (headings, bold,
  italic, lists, https and mailto links; everything else is escaped), with `{{name}}`;
- keep drafts and reusable templates, preview the rendered message and send a test to themselves;
- confirm the final send with the exact count. The campaign is then turned into one delivery per
  address, once, and sent in the background in bounded batches with progress, history and a
  failure list. "Accepted by the provider" is shown separately from "delivered";
- every message carries a signed unsubscribe link (one-click, RFC 8058). Members can also switch
  announcements off on their website profile. Unsubscribed, suppressed and no longer eligible
  members are skipped at send time, and the sender's permission is checked again before every
  batch.

**Sending is off** until the owner chooses the provider and sender address
([Deferred](#deferred-email-configuration-and-blockers)).

## Pages

Local development: Core at `http://localhost:3000`, the website at `http://localhost:3001`.

| URL                                                | Who                                                | What                                                                                          |
| -------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/admin/administration/permissions`                | `permissions.manage`                               | Every committee and team, with a summary of its permissions and leaders                       |
| `/admin/administration/permissions/committee/<id>` | `permissions.manage`                               | One committee: grouped checkboxes, scopes, Grant full access, Remove access, leaders, history |
| `/admin/administration/permissions/team/<id>`      | `permissions.manage`                               | The same for one team                                                                         |
| `/admin/membership/leadership`                     | `leadership.view`; editing `settings.verification` | Leadership requests and appointments, and the settings card                                   |
| `/admin/communications/email`                      | `email.send`                                       | Drafts, history and templates                                                                 |
| `/admin/communications/email/<id>`                 | `email.send`                                       | Composer (audience, message, preview, test, send) or a sent campaign's progress               |
| `/admin/account`                                   | Any dashboard user                                 | Own level, appointments and every permission with its scope                                   |
| `/profile` (website)                               | Members                                            | Leadership card with "Gives dashboard access"; Email announcements switch                     |
| `GET`/`POST /v1/email/unsubscribe?token=`          | Anyone with a signed link                          | Confirmation page; the POST unsubscribes                                                      |
| `GET`/`PATCH /v1/me/email-preferences`             | Signed-in members (website)                        | Read or change the announcements choice                                                       |
| `GET`/`POST /v1/internal/email-dispatch`           | A scheduler with the bearer secret                 | Sends at most one batch                                                                       |

## Assigning permissions and full access

1. Sign in to the dashboard as a Board or Technical administrator (they hold
   `permissions.manage`), or as anyone that permission was delegated to.
2. Open **Administration → Permissions** (`/admin/administration/permissions`) and choose a
   committee or a team.
3. Tick the permissions in each group; each line says what it allows. For each, choose
   **Society-wide** or **Own committee**.
4. Check **Affected leaders**: the approved, active Chiefs and Assistant Chiefs who will receive
   the change. Nobody else does.
5. Add an optional note and **Save**. Granting full access, or granting or removing permission
   management, asks you to confirm first.

- **Grant full access** ticks every permission society-wide. Its leaders then have Board-level
  access or more, including permission management, so they can delegate further.
- **Remove access** clears the group.
- The page refuses a change to a group you receive access through, and any change that would
  leave the society without a recovery account.
- To give one person access, appoint them Chief or Assistant Chief of a committee or team that
  has the permissions (Membership → Leadership), or give them a personal level on **Accounts &
  access** as before.

## Migration status

| Database                                                                                                                   | State                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Local test database (`uc02_test`, recreated for every run)                                                                 | Replays 0000–0036                                                     |
| Local browser-harness database                                                                                             | Replays 0000–0036                                                     |
| **Hosted development/staging**: the database both local apps are configured to use (verified from their environment files) | **Schema 36**: 0035 and 0036 applied on 2026-11-22 (owner-authorized) |
| Production                                                                                                                 | Untouched                                                             |

Applied to staging on 2026-11-22 with the owner's authorization: 0035 at history version
`20261122125742` (5.0 s), 0036 at `20261122125752` (4.6 s), each in one transaction with its
self-check. Before: a read-only inspection (schema 34, no drift in 75 compared routine
definitions, none of the new objects present), a verified backup (36 tables, 193 rows, every
routine definition; SHA-256 manifest; stored outside the repository) and a rollback script
generated from staging's own definitions, identical to the rehearsed one. Post-flight, read-only:
15 of 15 checks (below). Production is untouched.

Preparation (see [Migrations](how-to/migrations.md#migrations-0035-and-0036-permissions-and-email-centre)):

- read-only inspection: no drift in 75 compared routine definitions; none of the new objects
  exist; 2 Technical, 1 Board and 2 Committee Manager accounts (1 Society Affairs), 0 active
  appointments, 8 committees, 1 team, 1 member;
- local rehearsal from schema 34: apply (identical to a fresh 0000–0036 replay), rollback
  (identical to a 0000–0034 replay), apply again;
- impact: additive. 8 new tables, 52 new routines, 76 routines replaced with the same
  signatures, 6 indexes, 1 column (`max_holders_per_committee`, set from the team limit) and a
  wider audit action list. No existing row is deleted or otherwise changed. Board gains
  permission management, verification settings and the Email Centre; the Society Affairs
  manager gains verification settings; no leader gains anything (there are no appointments);
  Technical is unchanged.

Post-flight on staging (read-only, against the backup and a fresh local 0000–0036 replay):

- schema 36; history 0034, 0035, 0036 in order;
- schema identical to the replay: routines with owners and grants, columns, constraints, indexes,
  policies, RLS. Two environment differences are excluded: extension routines (pgcrypto lives in
  another schema on Supabase) and `private.access_auth_users.email` (`varchar` in Supabase Auth,
  `text` in the local stub; unchanged by these migrations);
- forced RLS on every private table; no runtime or browser role reads one; Core's entry points
  executable by the runtime role only; no routine newly executable by a browser role; new routines
  owned by `uc02_routine_owner`;
- every existing row unchanged on its pre-0035 columns; committee limits equal the team limits;
- seeds: 34 permissions, Society Affairs' 11;
- each of the 5 active administrators has exactly the mapped permissions, as the database itself
  answers (`get_dashboard_access`): Technical 28, Board 30, Committee Manager 6, Society Affairs
  Committee Manager 17;
- at least one recovery account; all 142 routines Core calls exist.

Real use was already visible during the post-flight: a member changed their email announcements
choice from the website (4 audited changes) and the dashboard's leadership page loaded the
settings. Because the Email Centre has now been used, the generated rollback script refuses to
run: changes go forward with a new migration, or by restoring the backup.

After the migrations, the running local Core's API routes that read the database (`/v1/health`,
`/v1/membership-options`, membership registration) stopped answering while dashboard pages still
worked. The migrations were not the cause: concurrent requests made the runtime client pipeline
queries through the transaction pooler, which lost a reply. Fixed the same day
([Known gaps](known-gaps.md), item 16).

## Verification

Kinds: **mocked** (unit tests with stubbed database calls), **database** (real PostgreSQL 17 with
the migrations, as the runtime role), **browser** (Playwright against both apps running locally on
a local database, with synthetic accounts).

| Check                                    | Kind                | Result                                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core type check, lint, Prettier          | Static              | Clean                                                                                                                                                                                                                           |
| Core unit and database suites            | Mocked and database | 77 files, 753 passed, 3 skipped                                                                                                                                                                                                 |
| `tests/db/permissions.test.ts`           | Database            | 11/11: level mapping, group configuration, team non-inheritance, active appointments only, combining scopes, revocation, full access, delegation, recovery guard, audit                                                         |
| `tests/db/email-centre.test.ts`          | Database            | 13/13: filters (AND/OR, deduplication, defaults), eligibility, queue once, claim with lease, retries, failures, suppression, unsubscribe, sender re-check                                                                       |
| Website type check, lint, tests          | Static and mocked   | Clean; 157/157                                                                                                                                                                                                                  |
| Profile, admin, event and projects flows | Browser             | All pass, including Board configuring a committee and its approved Chief receiving exactly those permissions (nothing else opens, even by URL), Society Affairs editing the settings, and composing a campaign with sending off |
| Email Centre with the test adapter       | Browser             | Real queue, batches, one message per member in the test outbox, unsubscribe link working                                                                                                                                        |
| Production builds                        | Build               | Core and website pass                                                                                                                                                                                                           |
| Live email delivery                      | None                | **Unverified**: no provider is configured                                                                                                                                                                                       |
| Migrations on the hosted database        | Hosted, read-only   | Applied 2026-11-22; post-flight 15/15                                                                                                                                                                                           |

## Performance

Measured on a local database with 5,000 members, before (schema 34) and after (schema 36).
Permission checks run in the database, once per row-set: `private.permission_committees`
computes a person's committees once per query, and the dashboard reads the person's access once
per request (`get_dashboard_access`, cached for that request). There is no cross-request cache, so
a change applies on the next request without invalidation.

| Database query                | Before  | After       |
| ----------------------------- | ------- | ----------- |
| One permission check          | ~0.2 ms | 0.15–0.2 ms |
| A person's dashboard access   | —       | 0.37 ms     |
| Events list (Board)           | 2.6 ms  | 1.3 ms      |
| Event counts                  | 2.4 ms  | 0.4 ms      |
| Membership overview           | 0.17 ms | 0.43 ms     |
| Members directory             | 5.8 ms  | 6.0 ms      |
| Audience count and first page | —       | 2–18 ms     |

| Page (server response, warm local server) | Before   | After    |
| ----------------------------------------- | -------- | -------- |
| Events (Board)                            | 92 ms    | 94 ms    |
| Events (Committee Manager)                | 81 ms    | 78 ms    |
| Membership (Board)                        | 119 ms   | 118 ms   |
| Membership (Society Affairs)              | 114 ms   | 116 ms   |
| Leadership                                | 138 ms   | 140 ms   |
| Projects (Society Affairs)                | 95 ms    | 91 ms    |
| Members                                   | 244 ms   | 244 ms   |
| Accounts & access (5,000 accounts)        | 1,511 ms | 1,603 ms |
| Permissions (new)                         | —        | 287 ms   |
| Email Centre (new)                        | —        | 113 ms   |

The Accounts page was already slow at this size: it lists every account. That is unchanged.

Sending: 25 messages per batch, each claimed with a 120-second lease, within a 20-second budget,
so a batch always finishes inside one request. Nothing continues after a response.

## Deferred email configuration and blockers

- **Owner decisions**: the email provider, the sender address and domain, and the DNS (Cloudflare)
  records. Nothing was chosen, purchased or changed, and no real email was sent.
- **Then**: add the provider's adapter, set `EMAIL_TRANSPORT`, `EMAIL_FROM`,
  `EMAIL_UNSUBSCRIBE_SECRET`, `EMAIL_DISPATCH_SECRET` and `APP_ORIGIN`, schedule
  `/v1/internal/email-dispatch`, and optionally wire the provider's delivery events. Steps:
  [Email Centre: going live](how-to/email-centre.md).
- Until then the page explains that sending is not configured; drafts, audiences, previews and
  templates work.
- **Other limits**: a team filter matches the team's leaders (teams have no member roster); without
  a scheduler a campaign progresses only while its page is open; without provider events messages
  stay "accepted".
