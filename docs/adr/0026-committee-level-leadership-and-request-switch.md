# ADR 0026: Committee-level leadership and the leadership request switch

**Amended by [ADR 0027](0027-configurable-committee-and-team-permissions.md) on 2026-11-22:** the
request switch is changed by holders of `settings.verification`, committee-level position limits
are separate from team limits, and appointments give their group's configured permissions.

Accepted on 2026-11-20 by the owner's request "Fix the Committee Leadership workflow". Migration
`0034_committee_leadership` implements it. It amends [ADR 0025](0025-expanded-membership-verification-and-leadership.md),
whose rule that every appointment sits in a team was wrong: many committees have no teams.

## Decision

### Scope of a request or appointment

- Every leadership request and appointment belongs to a **committee**. A **team is optional**:
  - **committee leadership**: Chief or Assistant Chief of the committee itself, for example
    "Society Affairs Committee → Assistant Chief";
  - **team leadership**: Chief or Assistant Chief of one of its teams, for example "Support &
    Logistics Committee → Technical Team → Chief".
- A committee with teams still offers committee leadership. Members choose the level when they
  request; team leadership is offered only when the committee has active teams.
- Storage, without duplicating facts:
  - `leadership_requests` already records the chosen `committee_id`; `team_id` becomes nullable.
  - `leadership_appointments` gains `committee_id`, set **only** for committee-level appointments.
    A team-level appointment keeps `team_id` and reads its committee from the team, so moving a
    team rewrites nothing. A check constraint requires exactly one of the two.
  - Existing rows (all team-level) satisfy this unchanged. Nothing is backfilled or deleted.
- Uniqueness per scope, including when the team is absent:
  - one active position per member per scope: 0033's `(member_id, team_id)` index, plus
    `(member_id, committee_id) WHERE committee_id IS NOT NULL` for committee level;
  - one pending request per member per scope: 0033's index, plus
    `(member_id, committee_id) WHERE team_id IS NULL AND status = 'pending'`;
  - one active holder of each position per scope by default (`max_holders_per_team`, now read
    as "per scope"), enforced under the exclusive organization lock as before, so concurrent
    approvals at committee level also serialize.
- A member may hold one position at committee level and one in each team, including in the same
  committee.
- Archiving a committee is refused while it, or any of its teams, has active appointments, and it
  closes pending requests at both levels.

### The request switch

- `verification_settings.leadership_requests_open` (default `true`, the behaviour before 0034)
  controls **new** requests only. When it is off, Core refuses new requests with
  `REQUESTS_CLOSED`, and the profile says requests are closed. Appointments stay visible and
  pending requests can still be approved or rejected.
- **Who switches it:** Board Administration and Technical, the senior administrators who manage
  committee structure. Society Affairs sees its state. Each change is audited
  (`leadership.requests_opened`, `leadership.requests_closed`).
- **Where:** the first card on Membership → Leadership (`/admin/membership/leadership`), which now
  has its own sidebar entry.

### Unchanged

Leadership reviewers (Board Administration and Society Affairs) decide requests and revoke
appointments, and directly appoint at either level. Technical manages teams and settings but does
not appoint or review. Nobody decides or appoints themselves. No appointment grants dashboard
access.

## Consequences

- Routines keep their signatures; `assign_leadership` gains a six-argument form with the
  committee, and the five-argument form remains for the previous Core.
- Member and reviewer payloads carry `level` (`committee` or `team`) and `team: null` for
  committee leadership; `GET /v1/me/leadership` and `GET /v1/me/leadership/options` carry
  `requestsOpen`, and the options list every active committee, with or without teams.
- The schema version becomes 34. The previous Core works on it; this Core needs it.
