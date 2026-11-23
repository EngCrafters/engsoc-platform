# Getting started

From a fresh clone to a running dashboard and API. Commands come from
[`package.json`](../../package.json) and were **inspected, not executed**, during this
documentation task. Read the project rules in [`CLAUDE.md`](../../CLAUDE.md) and
[`AGENTS.md`](../../AGENTS.md) first.

## Prerequisites

- **Node.js 22** (CI uses 22) and **npm**. The lockfile is `package-lock.json` (v3).
- **For the test suites:** Docker Desktop, which starts a disposable `postgres:17-alpine`. As an
  alternative, use a local PostgreSQL 17 and set `TEST_DATABASE_URL` to a loopback URL whose
  database name contains `uc02_test`.
- **For browser suites:** Playwright browsers (`npx playwright install chromium`), or set
  `EVENT_FLOW_BROWSER_CHANNEL=chrome` where supported to use installed Chrome.
- **For running against real data:** access to the **staging** Supabase project values. Never use
  production credentials for local work.

## Install

```bash
npm ci
```

The `prepare` script installs Husky hooks:

- `commit-msg` runs commitlint (Conventional Commits, lower-case subjects);
- `pre-commit` runs lint-staged, which formats staged files with Prettier.

## Configure

```bash
cp .env.example .env.local
```

The minimum to run the dashboard and API against staging:

| Variable                        | Value (from the staging project)                                      |
| ------------------------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Staging project URL                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging anon key                                                      |
| `APP_RUNTIME_DATABASE_URL`      | Staging **`app_runtime`** pooler URL (never the `postgres` owner URL) |

Optional, depending on what you work on:

- `SUPABASE_SERVICE_ROLE_KEY` for user administration;
- `SUPABASE_S3_*` for uploads;
- `CORE_API_ALLOWED_ORIGINS` when the website calls this Core;
- `AUTH_REDIRECT_ORIGIN` for dashboard recovery;
- `PUBLIC_WEBSITE_ORIGIN` for QR codes.

Every variable is described in [Configuration](../reference/configuration.md).

**Before starting, confirm all three values target staging.** `DATABASE_URL` is a separate
migration credential, not needed to run the app; never infer its target from the file name.

## Run

```bash
npm run dev            # http://localhost:3000
```

| URL                                 | What you get                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://localhost:3000/admin/login` | Dashboard sign-in. You need a staging Auth account and an active `administrative_access` grant to see more than the "no administrative access" page. |
| `http://localhost:3000/v1/health`   | `{"data":{"status":"ok"}}` when the database is reachable and at schema 33 or later; `schema-behind` (503) when it is older than the code            |
| `http://localhost:3000/`            | Core's own minimal public event list                                                                                                                 |

- **Without `APP_RUNTIME_DATABASE_URL`**, pages and routes that query the database fail at the
  first query, and `/v1/health` returns 503.
- **Without the Supabase public values**, dashboard sign-in fails and member routes return 503.

## Commands

| Command                                                             | Purpose                                                                                           | Needs                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run lint`                                                      | ESLint                                                                                            | none                                                                                |
| `npm run typecheck`                                                 | `next typegen && tsc --noEmit`                                                                    | none                                                                                |
| `npm run format:check`                                              | Prettier check over every tracked `js/ts/json/css/md/html/yaml` file                              | none                                                                                |
| `npm run db:check`                                                  | Drizzle journal consistency                                                                       | none                                                                                |
| `npm test`                                                          | Vitest: unit tests plus database suites, replaying all migrations into a disposable PostgreSQL 17 | Docker, or `TEST_DATABASE_URL`                                                      |
| `npm run test:integration`                                          | Live **staging** anon RLS checks                                                                  | `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`                                 |
| `npm run test:e2e`                                                  | Playwright against a production build and a disposable database                                   | Docker, browsers                                                                    |
| `npm run test:event-flow`                                           | Two-app event workflow (Core plus ESWebsite) with synthetic Auth and S3 adapters                  | A fresh loopback `uc02_test` database, both repositories installed, ports 3600–3602 |
| `npm run test:project-flow`, `test:profile-flow`, `test:admin-flow` | Two-app project, profile and administration flows                                                 | Same as event flow                                                                  |
| `npm run build`                                                     | Release gate, then `next build --webpack`                                                         | The gate only acts on Vercel                                                        |
| `npm run db:generate`, `db:migrate`, `db:studio`                    | Drizzle tooling against `DATABASE_URL`                                                            | **Writes to the target.** See [Migrations](../how-to/migrations.md).                |

CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) runs on pushes and pull
requests to `main`, in this order:

1. format, lint, migration consistency and type check;
2. tests against a Postgres 17 service;
3. the staging integration suite, using repository variables;
4. the build, with dummy environment values;
5. Playwright;
6. commitlint.

The test READMEs in [`tests/`](../../tests/) explain each suite's harness.

## Isolated local stack

To try membership, profiles, SQU verification and leadership end to end without any hosted
project, run the browser harness's stack and keep it open:

```bash
# Needs a fresh, empty loopback PostgreSQL 17 database whose name contains uc02_test,
# and ESWebsite installed next to this repository (../ESWebsite).
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:<port>/uc02_test npm run local:stack
```

| URL                                 | What                                            |
| ----------------------------------- | ----------------------------------------------- |
| `http://127.0.0.1:3601`             | The website (`/register`, `/login`, `/profile`) |
| `http://127.0.0.1:3600/admin/login` | The dashboard                                   |
| `http://127.0.0.1:3600/v1/health`   | Core health                                     |
| `http://127.0.0.1:3602`             | Synthetic Auth and S3 (test adapters, no email) |

It replays every migration into that database and prints the synthetic accounts (member, Society
Affairs, Board, Technical, a committee manager), all with the password `Synthetic-test-password-42!`.
Ctrl+C stops it; recreate the database before the next run. Ports 3600–3602 must be free, and it
uses the build folder `.next-event-flow`, so a normal `npm run dev` can run beside it.

## Run Core with the website locally

Either port layout works as long as the three addresses agree. Two that do:

| Core                     | Website                  | Website `CORE_API_BASE_URL` | Core `CORE_API_ALLOWED_ORIGINS`, `PUBLIC_WEBSITE_ORIGIN` |
| ------------------------ | ------------------------ | --------------------------- | -------------------------------------------------------- |
| `npm run dev` (3000)     | `npm run dev -- -p 3001` | `http://localhost:3000/v1`  | `http://localhost:3001`                                  |
| `npm run dev -- -p 3001` | `npm run dev` (3000)     | `http://127.0.0.1:3001/v1`  | `http://localhost:3000`                                  |

Restart a server after changing its env file. Against a hosted project, the database must be at
the code's schema version (`/v1/health` says `ok`); otherwise new routes answer 503.

1. Run Core on a port the website does not use, for example `npm run dev -- -p 3001`. The website
   example expects `http://127.0.0.1:3001/v1`.
2. In Core's `.env.local`:
   - set `CORE_API_ALLOWED_ORIGINS=http://localhost:3000`, the website's exact browser origin;
   - optionally set `PUBLIC_WEBSITE_ORIGIN=http://localhost:3000` so QR codes open the local site.
3. Give the website an API key registered in the database this Core uses (see
   [API clients and keys](../reference/configuration.md#api-clients-and-keys)), plus the same
   Supabase URL and anon key.
4. For member emails to return to the local site, the staging project's redirect allow-list must
   contain the local website's `/login` and `/reset-password`.

The cross-system checklist is in the
[system integration guide](../integration/system-integration.md#running-both-systems-locally).

## Safety rules (from the repository's instructions)

- Never run migrations or seed data against production.
- Never print or commit secrets.
- Use synthetic data in tests.
- Do not change hosted databases without explicit approval.
- Core's documented delivery path is a push to `main` (ADR 0007). Pushes deploy production through
  Vercel, so only push when you are authorized to release.
