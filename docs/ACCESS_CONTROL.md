# Application access contract

Status: accepted specification, October 4, 2026. ADR 0012 records the decision.
The specification gate passed in commit `b73b6ec`; the transferable ownership
decision is recorded in ADR 0012. Migrations 0016–0019 have been rehearsed
locally and applied to staging. Production rollout status is tracked in
[CURRENT_WORK.md](CURRENT_WORK.md).

## Hierarchy

| Action                                                 | Committee Manager | Board Administration | Technical Team                                |
| ------------------------------------------------------ | ----------------- | -------------------- | --------------------------------------------- |
| Own committee events, registrations, counts and export | Yes               | Yes                  | Yes                                           |
| Other committee events, registrations and export       | No                | Yes                  | Yes                                           |
| Global and per-committee counts                        | No                | Yes                  | Yes                                           |
| Committee selector                                     | No                | Yes                  | Yes                                           |
| Manage committee managers                              | No                | No                   | Yes                                           |
| Manage Board Administration                            | No                | No                   | Yes                                           |
| Manage Technical Team access                           | No                | No                   | Yes, with last-owner safeguard                |
| Application technical controls                         | No                | No                   | Yes                                           |
| Infrastructure, secrets, RLS, migrations               | No                | No                   | External technical maintenance procedure only |

`COMMITTEE_MANAGER` is exactly one Auth user to one committee ID. `BOARD_ADMIN`
has global operational scope. `TECHNICAL` has full application scope. None of
these levels is inferred from a name, email, Auth user metadata or UI state.
An authenticated user without active access has no administrative scope.

## Committee catalog

| Display name                  | Stable slug         | Current ordinary manager assignment            |
| ----------------------------- | ------------------- | ---------------------------------------------- |
| Support & Logistics Committee | `support-logistics` | Planned                                        |
| Relations Committee           | `relations`         | None                                           |
| Society Affairs Committee     | `society-affairs`   | None                                           |
| Finance Committee             | `finance`           | Planned                                        |
| Forum Committee               | `forum`             | None                                           |
| Evening Committee             | `evening`           | None                                           |
| Media Committee               | `media`             | Planned                                        |
| Technical Team                | `technical-team`    | None; Technical account uses the explicit role |

Technical Team is also a normal event-owning committee. Its slug and name give
no technical authority. No-manager committees are first-class records: Board
and Technical users may view their events and registrations, create and manage
events under the existing lifecycle rules, and see counts without an ordinary
manager account. Do not provision a fake manager or Auth user. A later real
manager needs only an Auth identity and a single committee assignment.

The existing `Events` row is legacy smoke data, not a ninth live committee.
Keep it with a null slug and retain its archived events, registrations, and
audit during migration verification. It is excluded from normal committee
filters and global operational counts. The old active manager grant is revoked
with migration audit; it confers no role in the new model. Verify the five
records' test provenance and lack of business value before a separate audited
cleanup. No final committee inherits that row or its records.

### Legacy `Events` cleanup procedure

1. Before changing data, compare the live row, event titles, archival state,
   registration counts and audit history with the recorded M8 smoke evidence.
   Stop if any event or registration has business value or provenance is unclear.
2. Capture a fresh restorable backup and rehearse cleanup against its isolated
   restore. Verify foreign keys, audit retention and all eight catalog rows.
3. Remove the legacy manager's active access as part of the access migration,
   recording the actual target user and old scope with `actor_kind = migration`.
   Do not assign a replacement role from that historical grant.
4. After the pilot, apply migration 0020. It renames only a legacy `Events`
   row whose events are all archived M8 smoke records and whose registration
   emails match test patterns. It retains all IDs and relationships and writes
   `legacy.smoke_archived` with event IDs and counts. If the preconditions fail,
   it leaves the row untouched for review. Do not run ad-hoc production SQL or
   change ownership to a real committee to make cleanup easy.
5. Verify the eight final committees, their event/registration relationships,
   RLS, counts and audit after cleanup. Keep the legacy row isolated if any
   deletion precondition fails.

## Assignment and recovery

`/admin/access` is available to Technical users. It shows a table of existing
Auth users, role, committee, status and actions. The Technical actor selects a
real authenticated user and one committee to grant `COMMITTEE_MANAGER`. If the
user already manages a different committee, the grant is rejected and the UI
offers explicit reassignment. Reassignment changes one row atomically, removes
the old scope immediately, establishes the new scope, and writes an audit row
with both states. Revocation retains the row and audit. Technical users may
grant and revoke `BOARD_ADMIN`; Board users cannot invoke this workflow.

An active Technical user can grant or revoke `TECHNICAL` through `/admin/access`.
The database serializes those changes and rejects removal of the final active
Technical identity, including through the maintenance routine. Transfer
ownership by granting the replacement first, verifying their account and global
access, then revoking the old account. The fixed external maintenance routine
is for initial bootstrap or verified recovery, never for routine replacement.
Neither route hardcodes an email. Infrastructure credentials and secrets stay
outside the application.

Any later committee is added as catalog data with a unique slug. Any later
manager is assigned through the same workflow. Neither action requires a new
route, RLS policy or role type.

## Data and audit

The existing `committee_managers` grant evolves into one
`administrative_access` row per Auth user with an access level and optional
committee ID. A CHECK requires the committee ID exactly for managers and
forbids it for global roles. The database primary key on user ID prevents
multiple manager scopes. Revoked access stays recorded. Existing grant rows
and the private UC-02 audit table are preserved; no parallel permission table
is added.

Supabase restricts custom-role usage of its `auth` schema. Migration 0017 adds
one private, read-only view of Auth user IDs and emails, owned by `postgres` and
selectable only by the private routine owner. Browser roles cannot query it.
The view contains no duplicate data or independent authorization state.
Migration 0018 retains explicit nulls in review-rejection audit state.
Migration 0019 makes Technical ownership transferable while preserving an active
owner. It adds narrowly granted routines and specific manager, Board and
Technical audit actions.
Migration 0020 is the controlled archive of confirmed legacy M8 smoke data;
it preserves events, registrations and audit foreign keys while making the
legacy status explicit. It is applied to production only after the pilot.

Every access mutation writes actor, target user, level, committee where
relevant, previous state, new state, timestamp and an optional bounded note.
The audit covers manager grant/reassignment/revocation, Board grant/revocation
and Technical grant/revocation. Audit writes occur in the same transaction as
access changes. The audit table remains private and append-only; authorized
Technical inspection uses a narrow server routine, not raw browser table
access. Do not record passwords, tokens or full attendee exports in audit.

## Authorization boundary

The server verifies the Auth user on each request. PostgreSQL is the source of
truth for active access and committee ownership. One central database
predicate handles global users and exact manager committee IDs; admin read,
write, count, pagination and export routines apply it. Authenticated RLS reads
use the same live access state. Public callers receive only public-safe event
fields. Direct event or registration mutations and private audit reads remain
denied to browser roles. Attendee identity is private. A count or cursor must
never include inaccessible rows. Revocation takes effect on the next operation
without waiting for a JWT refresh.

The UI repeats these exact safe errors:

| Condition                 | Message                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No admin access           | You’re signed in, but this account does not currently have administrative access.                                    |
| Wrong committee           | You don’t have permission to manage this committee.                                                                  |
| Global access required    | This action requires Board Administration or Technical Team access.                                                  |
| Technical only            | This action is available only to the Technical Team.                                                                 |
| Second manager assignment | This manager already belongs to another committee. Reassign their committee instead of creating a second assignment. |

SQL, RLS and credential errors are never shown to users.

## Review-required events

The user who flags or last edits review-relevant fields is the current review
subject, stored in `events.flagged_by`. Editing such fields invalidates an
earlier approval and sets `flagged_by` to the editor. A different active Board
Administration or Technical user may approve or reject. Board review is the
normal path; Technical review is the fallback. Managers have no reviewer
authority. Self-approval is denied even if the actor has global access.
Approval applies only to the current revision. Rejection leaves the event as a
review-required draft, clears approval, increments revision and writes audit;
it needs no new status or rejection table. Approval and rejection audit records
include actor, event, committee, prior and resulting review state and time.

## Acceptance and rollout

Tests must exercise Technical global reads, counts and access management;
Board global reads, committee filtering and technical denials; each active
manager's own list/count/export/lifecycle plus foreign denials; single-scope
uniqueness and atomic audited reassignment; managerless committee operations;
no-access Auth users; and public PII denials. Use real PostgreSQL roles and
rehearsed migrations, not UI visibility as security evidence.

| ID  | Required proof                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01 | Technical sees all eight committees, all events and registrations, global/per-committee counts, and can manage manager and Board access.                   |
| H02 | Board sees all eight committees, all events and registrations, global/per-committee counts; committee filter limits list, counts and export consistently.  |
| H03 | Board cannot read the access-management surface or invoke manager, Board, Technical, security or infrastructure changes.                                   |
| H04 | For each of the three current ordinary manager committees, own event list/detail/create/edit/lifecycle, registration list/count/promotion and export work. |
| H05 | For each manager, a foreign committee, event, registration, count, cursor, export and mutation are denied with no private data.                            |
| H06 | A second committee assignment is rejected; explicit reassignment changes scope atomically and audit records both old and new states.                       |
| H07 | A managerless committee is visible and operable to Board and Technical without a placeholder user or error.                                                |
| H08 | An Auth user with no active access sees no admin data and cannot invoke privileged routines, even with forged metadata or actor IDs.                       |
| H09 | Anon can read only public-safe event columns; admin operations and attendee PII remain denied.                                                             |
| H10 | Technical access transfers through the Technical-only application routine; the last active owner is protected and all changes are audited.                 |
| H11 | Catalog migration isolates legacy `Events`, preserves mapped Arabic IDs and event/registration/audit relationships, and creates no duplicate committee.    |
| H12 | A fresh database and a restored prior-version database both migrate successfully; backup recovery retains access, RLS and audit.                           |
| H13 | A different Board or Technical actor can approve/reject; manager and self-review are denied; approval and rejection are audited.                           |

Before production: review the ADR and finalized UC-02 companions; commit and
verify the specification; implement and test schema, routines, RLS and UI;
rehearse from a compatible backup in isolated PostgreSQL; inspect production
drift read-only; confirm backup and recovery; apply the reviewed migration;
pilot one named Technical, Board and Committee Manager account; verify positive
and negative paths; then assign the remaining current managers. Push through
GitHub `main` and verify GitHub Actions and Vercel. The landing-page migration
starts only after this layer is proven.

## Current production assignments

These emails are assignment data, never authorization constants. The owner will
grant future manager access as Technical Team lead through `/admin/access`.

| Access               | Committee                     | User / email                     | Status                                |
| -------------------- | ----------------------------- | -------------------------------- | ------------------------------------- |
| Technical Team       | All Committees                | hishamalhn@gmail.com             | Active; invitation pending acceptance |
| Board Administration | All Committees                | engineeringsociety.squ@gmail.com | Active                                |
| Committee Manager    | Support & Logistics Committee | To be provided                   | Unassigned                            |
| Committee Manager    | Finance Committee             | To be assigned by Technical lead | Unassigned                            |
| Committee Manager    | Media Committee               | To be assigned by Technical lead | Unassigned                            |

The earlier Support placeholder `unknown11110000@gmail.com` was revoked as
soon as the owner clarified that it was not the real manager. Its revoked row
and audit evidence remain, but it has no administrative access. Finance and
Media accounts were not created or assigned. Forum, Evening, Relations and
Society Affairs intentionally have no ordinary manager accounts. Actual pilot
status is recorded in [CURRENT_WORK.md](CURRENT_WORK.md).
