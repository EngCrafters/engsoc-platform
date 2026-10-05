# UC-02 admin identity

`server.ts` creates a fresh cookie-backed Supabase client for every request.
It uses only the public API key and the current user's session, so access
queries remain subject to Supabase RLS. `manager.ts` verifies identity with
Supabase Auth and then reads the active `administrative_access` row on every
request; it never authorizes from user metadata or a cached role claim.

`paths.ts` allows post-auth redirects only to internal `/admin` paths. Session
refresh is performed by the root `proxy.ts` before `/admin` and `/auth` routes
render. Password recovery needs `AUTH_REDIRECT_ORIGIN` (an https origin in
production, never localhost); its `/auth/callback` URL must be allowlisted in
Supabase Auth. No secret belongs in that variable or this repository.

`callback.ts` holds the pure recovery rules (link types, destination, expired
vs invalid, URL-fragment relay decisions, Auth email problems, password policy).
`app/auth/callback/route.ts` verifies a PKCE `code` or a `token_hash` link and
`components/auth/auth-hash-relay.tsx` removes session fragments from the URL.
`admin.ts` is the server-only Supabase Auth Admin module used by the
Technical-only `/admin/access` actions; it is the only reader of
`SUPABASE_SERVICE_ROLE_KEY` and never returns a password, token or link. See
`docs/AUTH_AND_EMAIL.md` and ADR 0013.

Tests: `tests/auth-callback.test.ts`, `tests/auth-callback-route.test.ts`,
`tests/auth-admin.test.ts`, `tests/user-actions.test.ts`,
`tests/db/auth-user-directory.test.ts`, `tests/auth-paths.test.ts`, `tests/manager-context.test.ts`,
`tests/admin-actions.test.ts`, and `tests/e2e/admin-auth.spec.ts`.

## Authority model

`getManagerContext` resolves the signed-in email, user id and explicit access
level. Committee Managers have one committee ID; Board Administration and
Technical Team have global application scope. `Technical Team` in the catalog
is a normal committee and its name grants no authority. An active Technical
user can transfer Technical ownership at `/admin/access`; the external
`app_maintenance` routine is reserved for bootstrap and recovery. See ADR 0012,
`docs/ACCESS_CONTROL.md`, and `docs/Platform_Maintenance_Runbook.md`. Never
branch on a specific email. `/admin/account` shows current scope; password
recovery never changes administrative access.

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
