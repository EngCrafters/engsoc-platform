# ADR 0027: Configurable committee and team permissions

Accepted on 2026-11-20 by the owner's request "Implement the agreed dashboard improvements"
(section 1: fully configurable committee and team permissions; section 2: editable verification
and leadership settings). Migration `0035_configurable_permissions` implements it. It supersedes
the statements in [ADR 0025](0025-expanded-membership-verification-and-leadership.md) and
[ADR 0026](0026-committee-level-leadership-and-request-switch.md) that an appointment never grants
dashboard access, and replaces the fixed authority rules of [ADR 0012](0012-application-access-hierarchy.md),
[ADR 0017](0017-membership-applications-and-review.md) (Society Affairs by slug) and
[ADR 0024](0024-administration-and-permanent-deletion.md) with explicit permissions. The personal
levels themselves (Board Administration, Technical, Committee Manager) remain.

## Decision

### One permission catalog

Every protected dashboard operation and backend routine requires a named permission from
`private.permission_catalog` (34 entries in 0035), grouped by area: events and registrations,
projects, membership, SQU verification, leadership, organization (committees and teams), settings,
accounts and access, and communications (Email Centre). Each entry has a plain description. Some
permissions are **scopable**: events, registrations, leadership and teams can be granted for the
group's **own committee** or **society-wide**. Everything else is society-wide only.

### Where a person's permissions come from

A person's effective permissions are the union of:

1. **Their personal level** (`public.administrative_access`, unchanged), through the fixed,
   explicit mapping `private.access_level_permissions`. It reproduces the access each level had
   before 0035, plus three additions the owner asked for: Board Administration also manages
   permission assignments, edits the verification and leadership settings, and uses the Email
   Centre. Technical keeps everything it had (including settings and recovery) and still has no
   SQU or leadership review authority (ADR 0025).
2. **Their committee, when they are a Committee Manager.** A Committee Manager acts for their
   committee: on top of the level mapping (events and registrations of their own committee), they
   receive whatever the committee's configuration grants.
3. **Their active appointments.** An approved, active Chief or Assistant Chief appointment grants
   the configuration of the appointment's own scope: a committee-level appointment the
   committee's, a team-level appointment the team's. Teams are attached to a committee but **do not
   inherit** its configuration, and a committee does not inherit its teams'. An archived committee,
   or a team that is not active, grants nothing. Pending requests, ended appointments and ordinary
   membership grant nothing.

Each grant keeps its scope: "own committee" resolves to the group's committee (for a team, its
parent committee). Several appointments combine permissions without widening any of them.

There is **no ceiling**: any committee or team can be granted any permission society-wide,
including account administration, settings and `permissions.manage`. **Full access** is every
permission in the catalog, society-wide, which includes everything Board Administration has.

### The Society Affairs exception becomes configuration

Membership review, SQU verification, leadership review, project review and the verification
settings were tied to the committee with slug `society-affairs`. 0035 seeds the Society Affairs
committee's configuration with exactly those permissions, so its Committee Manager keeps them, and
removes the slug checks. They can now be changed like any other group's. The seed also gives them
to any active committee-level Chief or Assistant Chief of Society Affairs, which is what the owner
asked for.

### Who changes permissions

`permissions.manage` (initially Board Administration and Technical) lets a person change any
committee's or team's configuration, including granting full access or `permissions.manage`. There
is no other Board-only check. Two safeguards:

- **No self-change** (superseded 2026-11-24 by ADR 0031 and migration 0040: holders of
  `permissions.manage` may change the groups they lead too, audited with `ownGroup`).
  Nobody changes the configuration of a group through which they currently hold
  access (an active appointment in it, or Committee Manager access to the committee). This matches
  the existing rule that nobody changes their own access.
- **Recovery account.** A change is refused (`LAST_RECOVERY_ACCOUNT`) if afterwards no active
  account could still manage both permissions and administrator access society-wide. The existing
  rule that at least one Technical account remains is unchanged.

Granting full access, or adding or removing `permissions.manage`, needs an explicit confirmation.
Every change is audited (`permissions.changed`) with the actor, the group, the previous and new
permissions and the time.

### Enforcement

- **Database (the authority).** `private.has_permission(actor, permission, committee)` and its
  locking forms decide every routine. The helpers the routines already called
  (`can_access_committee`, `lock_committee_access`, `can_review_event`, the reviewer-kind functions
  and `project_reviewer`) are redefined on top of it, and every routine that checked a level
  directly now names its permission. Browser RLS for events and registrations follows, because it
  calls the same helper.
- **Server.** The dashboard resolves the signed-in person's permissions once per request with
  `private.get_dashboard_access`; pages, server actions and route handlers check the permission
  they need before calling a routine, and the routine checks again.
- **UI.** Navigation and controls follow the same permissions. Hiding is never the protection.

There is no cache across requests, so a revocation, an ended appointment or a configuration change
takes effect on the next request. Within the database, routines that change state take the same
row and organization locks as before, so a decision cannot interleave with a revocation.

### Settings (section 2)

The existing verification and leadership settings become editable by `settings.verification`
(initially Board Administration, Technical and Society Affairs). Position limits are now separate
for committee level and team level: 0035 adds `max_holders_per_committee`, initialised from the
existing limit so nothing changes until someone edits it. "No limit" (empty) and "not set" (empty
retention: evidence is kept) stay distinct; zero is not accepted. Lowering a limit never ends an
appointment. Setting or shortening the retention period shows how many documents would become
eligible for deletion and needs an explicit confirmation; nothing is deleted when the setting is
saved.

## Consequences

- An appointment can now grant dashboard access. Profiles say that access depends on the
  permissions assigned to the member's approved committee or team appointments.
- Reviewer labels in audit entries written from 0035 on are `reviewer` or `senior` (final
  approval); earlier entries keep `society_affairs`.
- The personal level mapping is fixed in the migration. Changing what a level means needs a new
  migration and decision.
- A person with `permissions.manage` can grant full access to another group, including one led by
  a friend. That is the model the owner chose; the audit history makes every grant visible.
