# 0031 — Permission management covers the groups you lead

Status: accepted (owner direction, 2026-11-24). Amends ADR 0027's "No self-change" safeguard;
everything else in ADR 0027 stands.
Related: ADR 0027 (configurable committee and team permissions), ADR 0030 (Board Administration
holds the membership settings), migration `0040_permission_management_own_groups`

## Context

The owner set the platform up as intended by ADR 0027: the Society Administrator (personal Board
Administration level) created a "Board Administration" committee, gave it full access, and made a
member its Committee Manager and Chief. That Chief could change every other committee and team,
but not Board Administration, Evening or Finance: the three committees the Chief leads. ADR 0027
refused any change to a group through which the actor holds access (`SELF_CHANGE`), and the editor
was locked for those groups. The owner reported this as delegation not working, and decided that
global permission-management authority must also cover the groups its holder leads.

## Decision

Whoever holds `permissions.manage` society-wide may change the configuration of **any** committee or
team, including the ones they lead or manage, and may grant them any permission up to full access.

Unchanged:

- Only `permissions.manage` authorizes a change. The database re-checks it under the organization
  lock in `private.set_group_permissions`; the dashboard checks it before calling the routine.
- Every committee and team has its own configuration; nothing is inherited between a committee and
  its teams. Approved, active Chiefs and Assistant Chiefs receive exactly their group's permissions
  (a committee's Committee Manager receives the committee's).
- Granting full access, or adding or removing `permissions.manage`, needs explicit confirmation.
- A stale editor is refused (`STALE_REVISION`).
- `LAST_RECOVERY_ACCOUNT` still refuses a change that would leave no account able to manage both
  permissions and administrator access.
- The Society Administrator's personal level keeps `permissions.manage` through the fixed level
  mapping, which no group change can remove.
- Every change is audited (`permissions.changed`). The audit row now also carries
  `ownGroup: true` when the actor held access through the group they changed.

The editor no longer locks: for a group the viewer holds access through it says "what you save
here also changes your own access", and the confirmation dialog says the change includes them.

## Consequences

- A leader with `permissions.manage` can give their own committee or team more access, including
  full access, and keep it as long as the group's configuration stays. Removing it needs another
  holder of `permissions.manage` (or the leader themselves). The `ownGroup` flag in the audit
  history makes these changes easy to find.
- A delegate can also remove their own group's `permissions.manage`, and then loses it.
- Other self-protections are unchanged: nobody changes their own administrator access or deletes
  their own account or member record.
