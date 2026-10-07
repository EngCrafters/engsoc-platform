# Access boundary

`server.ts` uses only the restricted runtime connection and fixed private routines.
Auth identity is separate from `administrative_access`; current grants authorize
all operations. `messages.ts` shares safe domain messages between account creation
and access changes. Migration 0023 adds atomic selected-manager replacement and
serializes it with all other role mutations; each replacement writes both target
histories. No direct table writes or generic service-role DB helper belongs here.

See `docs/ACCESS_CONTROL.md`, ADR 0014 and the maintenance runbook for onboarding,
replacement, revocation, session limitations, historical attribution and exceptional
Auth deletion. Auth creation/password/email calls remain in `lib/auth/admin.ts`
and preserve the safe partial-success reconciliation messages.
