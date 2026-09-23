# ADR 0009: Platform ownership is an external maintenance authority

## Status

Accepted; owner decision, September 21, 2026.

## Context

Committee-manager login (M5) raised the question whether the platform needs an
application-level owner or super-admin role. `docs/UC-02_Data_and_Security.md` §4
and §6 and `db/schema.ts` already state that there is no such role: presence of
an active `committee_managers` grant is the only application capability, and the
provisioner is "a deployment/maintenance authority, not an application role".

## Decision

Keep that model. Do not add an owner table, enum, claim, cookie or authorization
path. Ownership and maintenance stay outside the application, held by whoever
administers the Supabase project and runs the `app_maintenance` role.
`committee_managers` remains the highest application role, and no authorization
logic may reference a specific email address.

The application makes this visible instead: the admin shell labels users
"Committee manager", `/admin/account` explains scope and authority, the
no-grant screen explains that recovery does not restore access, and
`docs/Platform_Maintenance_Runbook.md` documents bootstrap, recovery, transfer
and revocation.

## Consequences

- Revoking a manager grant cannot affect platform ownership; they are unrelated.
- Grant and revoke are fixed, maintenance-only database routines (migration 0010) that write the grant and its audit row atomically; credential rotation
  stays manual maintenance work. There is no in-app control for any of them.
- Every maintainer needs a named Auth user to be recorded as `granted_by` /
  audit actor. It is an attribution identity only and holds no grant. The first
  grant is flagged `bootstrap` by the routine itself, not by convention.
- Recovering lost Supabase/project access is a Supabase-account matter, not
  something the app can solve. The runbook records the paths.
- Introducing an application-level owner later needs a new ADR that supersedes
  this one, plus an updated data contract before any schema change.
