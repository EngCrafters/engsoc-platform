# UC-02 database security regression suite

`npm run test` runs this suite alongside the staging anon-RLS regression test.
It applies every SQL migration in `db/migrations/` to a fresh isolated
PostgreSQL 17 database, including the actual roles, grants, RLS policies, and
private routines. It never uses a Supabase project or production data.

## Local execution

Install Docker Desktop and run:

```bash
npm run test
```

The Vitest global setup starts a disposable `postgres:17-alpine` container,
uses a randomly named container, and removes it after the test run. To use an
already-running local PostgreSQL 17 instance instead, set
`TEST_DATABASE_URL` to a localhost URL whose database name contains
`uc02_test`; any other host or database name is rejected before migrations
run.

The test-only runtime password is assigned after migrations and is never read
from an application environment variable. No production or staging credential
is used by this suite.

## Coverage

- `app-runtime-security.test.ts`: role login/BYPASSRLS, direct DML and schema
  denial, approved versus unapproved private routine execution.
- `routines-and-authorization.test.ts`: committee scope, review/approval,
  lifecycle transitions, authenticated manager RLS, and audit atomicity.
- `registration-concurrency.test.ts`: normalized duplicate protection, real
  concurrent duplicate and final-seat races, and FIFO waitlist promotion.

The existing `tests/rls-staging-anon.test.ts` remains the live staging anon
projection/denial regression suite.
