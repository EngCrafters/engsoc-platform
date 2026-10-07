# ADR 0014: Access lifecycle and identity retention

## Status

Accepted October 7, 2026, from the owner's focused lifecycle instruction.
Extends ADRs 0012/0013 without changing the approved access hierarchy.

## Decision

- Auth identity, active application authorization, committee scope, and immutable
  history are distinct. An existing or confirmed Auth account confers no access.
- Revocation retains the identity and historical grant row. Its former role and
  committee are historical metadata only: live authorization requires
  `revoked_at IS NULL`. The directory shows no effective role/scope after revoke.
- Replace manager names the current manager, expected committee and replacement
  identity. One fixed Technical-only PostgreSQL routine revokes the old grant,
  grants the new one, and records both states with a shared replacement ID in
  one transaction. An already active replacement or stale old scope is rejected.
  Existing events and history never move to the new actor.
- The existing model permits multiple managers in a committee, each with exactly
  one committee. Replacement affects the selected manager only. No new exclusive
  staffing policy or committee-level uniqueness constraint is introduced.
- All access mutations use the existing Technical-ownership transaction lock
  before row locks. This also serializes concurrent elevated/ordinary grants for
  the same identity. Operational writes retain their grant-row share lock:
  either an authorized operation completes before revocation, or it observes
  revocation and is denied. New requests use current server/database state.
- Ordinary offboarding does not ban Auth, reset a password, or delete a user.
  The supported `auth.admin.signOut(jwt, scope)` requires the target session JWT;
  it is not a user-ID revocation API. We do not collect/store target tokens or
  mint impersonation tokens. Normal user sign-out remains supported; no automatic
  session-invalidation claim or fabricated session audit event is made.
- Auth deletion remains exceptional infrastructure maintenance. A Technical
  requester must establish disposable provenance and absence of every historical
  reference, including audit JSON target IDs as well as foreign keys, grants,
  event actors and other schemas. A retained revoked grant/history makes a user
  ineligible (`USER_HAS_HISTORY`). Never delete references to make deletion pass.
  If an identity is genuinely unreferenced, an authorized maintainer may use the
  supported Auth Admin `deleteUser` API after quiescing concurrent provisioning.
  No generic delete button or cascading cleanup is added in this small change.
- Existing safe reconciliation messages remain for external Auth operations
  whose separate database audit write fails. Access mutations fail atomically
  if their audit write fails.

## Evidence required

Concurrent grants/replacement/revocation tests, stale-scope rejection, current
role checks at routes/actions/RLS/routines, audit rollback and attribution,
Technical transfer/last-owner tests, clean migration replay, staging rehearsal,
and read-only production reconciliation. Recovery and Board acceptance passes
reported by the owner are retained; automatic regressions cover shared behavior.
Real Support onboarding waits for the owner's real identity, with no placeholder.

## References

- [Supabase admin sign-out](https://supabase.com/docs/reference/javascript/auth-admin-signout)
- [Supabase sign-out scopes and token expiry](https://supabase.com/docs/guides/auth/signout)
- [Supabase Auth deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)

The installed Auth SDK was inspected alongside these references. Access tokens
can remain valid until expiry after sign-out; live application grants remain the
authorization boundary independently of session lifetime.
