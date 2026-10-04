# ADR 0012: Application access hierarchy and committee catalog

## Status

Accepted specification, October 4, 2026. The owner resolved the legacy
`Events` row and reviewer authority on this date. The application and database
implementation follows only after this specification and its UC-02 companions
are committed, pushed, and verified in CI. Production emails are changeable
rollout assignments, not authorization constants; the owner withdrew the
placeholder Support address before the manager pilot.

## Context

UC-02 currently gives Auth users independent committee-manager grants, including
more than one committee per user. Its routines and RLS use those grants. The
owner has now selected three explicit application access levels, a single
committee per ordinary manager, and eight named committees. The project already
has a private audit table and restricted database roles. Those structures should
carry the new hierarchy without introducing a general permission engine.

## Decision

### Scope and authority

| Access level        | Committee scope                | Operational data                                                                    | Access management                                  |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `COMMITTEE_MANAGER` | Exactly one assigned committee | Own events, registrations, counts, lifecycle and export                             | None                                               |
| `BOARD_ADMIN`       | All committees                 | Society-wide events, registrations, counts, filters, lifecycle and existing exports | None                                               |
| `TECHNICAL`         | All committees                 | All application operational data and lifecycle functions                            | Managers, Board Administration, and Technical Team |

Technical authority comes from the explicit access level, never from the
`Technical Team` committee name, slug, or membership. Board Administration has
no infrastructure, secret, RLS, migration, Technical-grant or self-escalation
authority. A signed-in user with no active access row has no admin capability.
Public access remains limited to public-safe event data.

### Data and enforcement

Evolve the existing `committee_managers` grant into one application-access row
per Auth user. Rename it to `administrative_access`; retain existing grants and
audit history. Its `access_level` is exactly `TECHNICAL`, `BOARD_ADMIN`, or
`COMMITTEE_MANAGER`. `committee_id` is required only for a manager and null for
the two global roles, enforced by a database CHECK. `user_id` is unique/primary,
so a manager cannot hold two active committee assignments. A revoked row is
inactive; reactivation or reassignment changes that row under a lock and writes
an audit entry in the same transaction. Existing UC-02 event, registration,
count and export routines use one central database predicate for current scope.
RLS uses the same predicate for authenticated reads. Every mutation rechecks
current access in the database, including after concurrent revocation.

Add a stable unique `slug` to `committees`, independent of its display name.
The catalog contains exactly these eight active names/slugs:

| Name                          | Slug                | Manager required now                              |
| ----------------------------- | ------------------- | ------------------------------------------------- |
| Support & Logistics Committee | `support-logistics` | Yes                                               |
| Relations Committee           | `relations`         | No                                                |
| Society Affairs Committee     | `society-affairs`   | No                                                |
| Finance Committee             | `finance`           | Yes                                               |
| Forum Committee               | `forum`             | No                                                |
| Evening Committee             | `evening`           | No                                                |
| Media Committee               | `media`             | Yes                                               |
| Technical Team                | `technical-team`    | No ordinary manager required for Technical access |

The Technical Team committee may own events and registrations like any other
committee. Board and Technical users can operate a committee without a manager.
New committees and later manager assignments are data operations. Catalog
migration preserves IDs and foreign keys where possible, maps equivalent Arabic
names deliberately, and fails on ambiguous duplicates. It creates no Auth users.
The existing generic `Events` row is **not** a final committee. Keep it and its
archived smoke records isolated during migration safety verification, with a
null catalog slug so it is absent from normal administration. Revoke its old
manager grant as a migration change with audit, without inferring a new role
for that person. After verifying the five records are only smoke data and have
no business value, apply the reviewed archive migration after backup and
migration safety checks. It marks
the legacy identity explicitly while retaining event, registration and audit
foreign keys, and records the action in audit. Do not copy their history into a
real committee.

### Review-required events

O-01's reviewer authority changes: only an active `BOARD_ADMIN` or `TECHNICAL`
user may approve or reject a review-required event, and that user must differ
from the person whose current work requires review. Board is the preferred
normal reviewer; Technical is a fallback. A Committee Manager cannot approve
their own or another review-required event. `flagged_by` represents the current
review subject: when a review-required event is edited in a review-relevant
field, approval is invalidated and `flagged_by` becomes that editing actor.
This preserves the existing self-approval database constraint without adding
a column. Approval records the current revision. Rejection keeps the event in
draft with review required, clears any approval, increments the revision and
records an audit entry; it does not create a new event status. Every approval
or rejection audit entry contains actor, event, committee, previous and new
review state, and timestamp. Event lifecycle guards outside reviewer authority
remain in force.

### Access workflows

`/admin/access` is Technical-only. It lists existing Auth users, access level,
committee, status and actions. A Technical user can grant, revoke and atomically
reassign a manager, and grant or revoke Board Administration. A second manager
committee assignment fails with a specific reassignment result. Technical
users can also grant and revoke Technical Team access through this screen.
The external maintenance routine is reserved for initial bootstrap and recovery.
Board users cannot invoke any access routine. The database serializes Technical
membership changes and refuses to revoke the last active Technical identity,
including through maintenance. Ownership transfer grants the new Technical
account first, verifies its access, then revokes the old account. Emails are
assignment data, never authorization rules.
Neither a manager nor a board user can promote themselves. Every access change
records actor, target, level, committee where relevant, prior and new state,
time and optional note in the existing append-only private audit table. Global
access changes have no artificial committee owner in audit.

The admin UI labels global users `Administration` / `All Committees` and offers
an `All Committees` filter plus every catalog committee. Each record shows its
owner. Technical users have a separate `Technical Administration` area. An
ordinary manager sees their one committee as a fixed label, without a
committee switcher. Client visibility mirrors server/database authorization;
it is never the authorization boundary.

### Rollout

Rehearse on Supabase-compatible PostgreSQL, including an upgrade from the
existing migration chain and a backup restore. Inspect production drift and
confirm recovery before applying the reviewed migration. Pilot one real
Technical user, one real Board user and one real manager. Verify the positive
and negative access matrix through the deployed app and PostgreSQL. Then
assign the remaining Support & Logistics, Finance and Media managers from
owner-supplied identities. Forum, Evening, Relations and Society Affairs stay
managerless. Do not create placeholder users, infer identity from email
patterns, or start the landing-page migration during this work.

## UC-02 supersession

This later owner decision supersedes UC-02's multi-committee manager grants,
manager-only global access model, old committee selector behavior, the
maintenance-only manager grant workflow, and O-01's requirement that a second
manager from the same committee review. UC-02's event lifecycle, permanent
records, two-person and no-self-review constraints, public registration,
private attendee data and audit guarantees remain binding. Existing external
infrastructure maintenance authority remains separate from the application
`TECHNICAL` level.
