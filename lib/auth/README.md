# UC-02 admin identity

`server.ts` creates a fresh cookie-backed Supabase client for every request.
It uses only the public API key and the current user's session, so manager
queries remain subject to Supabase RLS. `manager.ts` verifies identity with
Supabase Auth and then reads active `committee_managers` grants on every
request; it never authorizes from user metadata or a cached role claim.

`paths.ts` allows post-auth redirects only to internal `/admin` paths. Session
refresh is performed by the root `proxy.ts` before `/admin` and `/auth` routes
render. Password recovery needs `AUTH_REDIRECT_ORIGIN`, whose callback URL must
be allowlisted in Supabase Auth; no secret belongs in that variable or this
repository.

Tests: `tests/auth-paths.test.ts`, `tests/manager-context.test.ts`,
`tests/admin-actions.test.ts`, and `tests/e2e/admin-auth.spec.ts`.
