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

## Authority model

`getManagerContext` resolves the signed-in email, user id and active committee
grants. There is deliberately no owner or super-admin concept: a committee
manager is the highest application role, and platform ownership is an external
maintenance authority (Supabase project + `app_maintenance`). See
`docs/adr/0009-external-platform-maintenance-authority.md` and
`docs/Platform_Maintenance_Runbook.md`. Never branch on a specific email.
`/admin/account` (read-only) shows a manager their identity, scopes and how
recovery works; recovery changes the Auth password, never committee grants.

`local-review.ts` is a dev-only escape hatch, not a production path: when an
explicit `UC02_LOCAL_REVIEW_DATABASE_URL` env var points at `127.0.0.1` /
`localhost` and `VERCEL` is unset (not `NODE_ENV` — this repo's own local
review and E2E setup intentionally runs as `NODE_ENV=production` via
`next start`), `resolveManagerContext` reads
committee scope from that local database instead of Supabase, so the shell,
account page, event list and event detail all agree during local visual
review. Signed-in identity still always comes from real Supabase Auth. The
variable is never committed or added to `.env.example`; export it only in the
shell session running the local review server. See
`tests/local-review-auth.test.ts`.

For M6 visual review, run `npx tsx scripts/m6-local-review.ts <account UUID>`
with Docker Desktop running. The UUID appears on `/admin/account` after sign-in.
The script replays migrations into a disposable localhost PostgreSQL 17
container, seeds three local events and a grant for that UUID, then starts
Next.js on port 3000 with the local database URLs set only in its process.
Stopping the launcher removes the container. It does not apply migrations or
grants to staging.
