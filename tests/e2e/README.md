# UC-02 public-site E2E suite

`npm run test:e2e` runs Playwright against a real, disposable stack: the
same isolated PostgreSQL 17 container and migration replay as `tests/db`
(reused via `../db/global-setup`), seeded with fixed fixture events
(`fixtures.ts`), fronting a real **production build** (`next build` +
`next start`) — not `next dev`. Dev-mode Turbopack's HMR WebSocket is
unreliable in some environments and can leave a resolved page inert behind
its Suspense fallback; a production build has no such dependency and is
what Vercel actually serves.

Desktop and mobile projects share one dev server and one database, so the
suite runs with `workers: 1` (sequential) and each project gets its own
simulated `x-vercel-forwarded-for` header (`playwright.config.ts`) — the app
runs as `NODE_ENV=production` here, so `app/(marketing)/actions.ts` trusts
only that header for rate-limiting, exactly as it would behind real Vercel.
Tests that register/waitlist use a per-project email
(`` `visitor-${testInfo.project.name}@example.test` ``) so the two projects'
runs against the same fixture event don't collide.

Fixture events (`fixtures.ts`): `open`, `full` (manually held), `past`,
`draft`, and `waitlist` (capacity 1, pre-filled by one confirmed
registration — proves numerically-derived "waitlist" availability, distinct
from the manual `full` hold), plus 21 paged events for pagination coverage.

Requires Docker Desktop. No Supabase project or production data is touched.
