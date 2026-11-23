# Configuration

Every environment variable Core reads. They were found by searching `process.env` and
`env[...]` in `app/`, `lib/`, `db/`, `proxy.ts`, the configuration files and `scripts/`, and
cross-checked against [`.env.example`](../../.env.example), CI
([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) and the tests (**Source**). Never
copy real values into documentation, tickets or chat.

Vercel applies variable changes **only to deployments created afterwards**: redeploy after every
change. `NEXT_PUBLIC_*` values are also **inlined into the browser bundle at build time**, so
changing them requires a new build.

## Application runtime

| Variable                                                                                                   | Required                                                                                                                          | Exposure                                 | Read at                                    | Read by                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                                                 | Yes                                                                                                                               | Browser (inlined) and server             | Build (client bundle) and runtime (server) | `lib/auth/server.ts`, `lib/auth/member.ts`, `lib/auth/admin.ts`, `lib/supabase/proxy.ts`, `app/auth/callback/route.ts`, `components/auth/auth-hash-relay.tsx` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                                            | Yes                                                                                                                               | Browser (inlined) and server             | Build and runtime                          | same                                                                                                                                                          |
| `APP_RUNTIME_DATABASE_URL`                                                                                 | Yes                                                                                                                               | Server only, **secret**                  | Runtime; build (release gate on Vercel)    | `db/index.ts`, `scripts/check-schema-compat.mjs`                                                                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                | For user administration, invitations, membership activation invitations, account erasure, immediate account activation (ADR 0030) | Server only, **secret**                  | Runtime                                    | `lib/auth/admin.ts`; `app/admin/(protected)/access/page.tsx` (shows whether tools are configured)                                                             |
| `CORE_API_ALLOWED_ORIGINS`                                                                                 | When any website origin other than the defaults calls the API                                                                     | Server only                              | Runtime                                    | `lib/api/cors.ts`                                                                                                                                             |
| `APP_ORIGIN`                                                                                               | Production (CSV exports)                                                                                                          | Server only                              | Runtime                                    | `lib/security/request-origin.ts`                                                                                                                              |
| `AUTH_REDIRECT_ORIGIN`                                                                                     | For dashboard recovery and invitations                                                                                            | Server only                              | Runtime                                    | `lib/auth/server.ts` `authRedirectUrl()`                                                                                                                      |
| `PUBLIC_WEBSITE_ORIGIN`                                                                                    | No (default `https://essqu.com`)                                                                                                  | Server only                              | Runtime                                    | `lib/event-management/qr.ts`                                                                                                                                  |
| `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` | For any Storage use                                                                                                               | Server only; the two keys are **secret** | Runtime                                    | `lib/membership/storage.ts` and the other storage modules                                                                                                     |
| `SUPABASE_S3_MEMBERSHIP_BUCKET`                                                                            | For SQU verification evidence (and legacy ID cards) in Storage (otherwise the database fallback)                                  | Server only                              | Runtime                                    | `lib/membership/storage.ts`, `lib/event-management/images.ts`, `lib/members/photos.ts`, `lib/projects/storage.ts`                                             |
| `SUPABASE_S3_EVENT_BUCKET`                                                                                 | For event covers                                                                                                                  | Server only                              | Runtime                                    | `lib/event-management/images.ts`, `lib/administration/server.ts`, …                                                                                           |
| `SUPABASE_S3_PROJECT_BUCKET`                                                                               | For project images                                                                                                                | Server only                              | Runtime                                    | `lib/projects/storage.ts`, `lib/administration/server.ts`, …                                                                                                  |
| `SUPABASE_S3_MEMBER_PHOTO_BUCKET`                                                                          | For member photos                                                                                                                 | Server only                              | Runtime                                    | `lib/members/photos.ts`, `lib/administration/server.ts`                                                                                                       |
| `MEMBER_PHOTO_UPLOADS`                                                                                     | No (enabled unless `disabled`)                                                                                                    | Server only                              | Runtime                                    | `lib/members/profile.ts` `memberFeatures()`                                                                                                                   |
| `MEMBER_PROFILE_EDITING`                                                                                   | No (enabled unless `disabled`)                                                                                                    | Server only                              | Runtime                                    | same                                                                                                                                                          |
| `CORE_API_HOST_ENFORCEMENT`                                                                                | No (off unless exactly `true`)                                                                                                    | Server only                              | Runtime                                    | `lib/api/host-policy.ts` via `proxy.ts`                                                                                                                       |
| `DATABASE_URL`                                                                                             | Only to run migrations with Drizzle                                                                                               | Local operator only, **secret**          | Command line                               | `drizzle.config.ts`. **Never a runtime fallback.**                                                                                                            |
| `RESEND_API_KEY`                                                                                           | Not read by any code                                                                                                              | n/a                                      | n/a                                        | Listed in `.env.example` as reserved. Auth email uses SMTP configured in Supabase.                                                                            |
| `VERCEL`, `VERCEL_ENV`, `NODE_ENV`                                                                         | Set by the platform                                                                                                               | n/a                                      | Build and runtime                          | Release gate, storage endpoint rules, QR origin rules, cookie `secure` flag, dev-only pages                                                                   |
| `ESSQU_EVENT_FLOW`                                                                                         | Test harness only                                                                                                                 | n/a                                      | Build                                      | `next.config.ts` (`distDir: .next-event-flow`)                                                                                                                |
| `UC02_LOCAL_REVIEW_DATABASE_URL`                                                                           | Local visual review only                                                                                                          | Local shell only                         | Runtime                                    | `lib/auth/local-review.ts`. Inert when `VERCEL` is set or the host is not loopback.                                                                           |

## Details and failure modes

### Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

- **Where to get them.** Supabase dashboard → Project Settings → API, for the environment's
  project. The website's `SUPABASE_URL` and `SUPABASE_ANON_KEY` **must be the same project**.
- **Missing public values:**
  - dashboard sign-in throws ("Supabase public runtime configuration is missing");
  - `proxy.ts` skips session refresh;
  - `/auth/callback` redirects with `link=invalid`;
  - member routes return 503, because the token cannot be verified.
- **Missing service-role key:** immediate account activation (ADR 0030) is unavailable and
  registrations fall back to email confirmation; the dashboard says so. Auth Admin operations fail. That covers invitations, temporary
  passwords, creating users, membership activation for applicants without an account, and the
  final Auth deletion of an erased account (the erasure stays "pending"). `/admin/access` shows
  that the tools are not configured.
- **Exposure.** The service-role key is read only in `lib/auth/admin.ts`. It must never get a
  `NEXT_PUBLIC_` name.

### Database: `APP_RUNTIME_DATABASE_URL` and `DATABASE_URL`

- **`APP_RUNTIME_DATABASE_URL`** is the restricted `app_runtime` login, normally through
  Supabase's **transaction pooler** (port 6543).
  - The client uses one connection, no prepared statements, and TLS required except for
    `127.0.0.1` or `localhost` ([`db/index.ts`](../../db/index.ts)).
  - It never pipelines: one query at a time per connection, the rest wait their turn
    ([`db/one-query-per-connection.ts`](../../db/one-query-per-connection.ts)). Supabase's
    transaction pooler can lose a pipelined query's reply, which hung Core until restarted.
  - It is created lazily: a missing value fails at the first query
    ("APP_RUNTIME_DATABASE_URL is required…"), not at import.
  - **On Vercel Production, `npm run build` fails** when this URL is missing, unreachable, logs in
    as a superuser or a role that bypasses RLS, or points at a database older than the code's
    migrations ([`scripts/check-schema-compat.mjs`](../../scripts/check-schema-compat.mjs)).
    Preview builds only warn.
- **`DATABASE_URL`** is a privileged migration credential for `npm run db:migrate`, `db:studio`
  and `db:generate`. Never set it in Vercel runtime scopes. Never infer its target from the file
  name; confirm it before every use. Hosted migrations in this project have been applied through
  Supabase tooling, not this variable (see [Migrations](../how-to/migrations.md)).

### Origins: `CORE_API_ALLOWED_ORIGINS`, `APP_ORIGIN`, `AUTH_REDIRECT_ORIGIN`, `PUBLIC_WEBSITE_ORIGIN`

| Variable                   | Format and example (fictional where secret)                                                           | Effect when wrong or missing                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORE_API_ALLOWED_ORIGINS` | Comma-separated exact origins: `https://essqu.com,https://www.essqu.com,https://essqu-web.vercel.app` | Unset means only `https://essqu.com` and `https://www.essqu.com`. Browser calls from any other origin (Vercel aliases, Preview, `http://localhost:3000`) get 403, or are blocked by the browser.                                                                  |
| `APP_ORIGIN`               | Bare `https` origin, for example `https://admin.example.test`                                         | In production, CSV export POSTs are refused with 403 when unset or not equal to the request's `Origin`. Development accepts loopback origins without it. `.env.example` names `https://engsoc-platform.vercel.app`; check it matches the host administrators use. |
| `AUTH_REDIRECT_ORIGIN`     | Bare origin; the app appends `/auth/callback`                                                         | Unset or invalid means "Password recovery is temporarily unavailable", and invitations carry no redirect. Production requires `https` and a non-localhost host. The resulting URL must be on Supabase's redirect allow-list.                                      |
| `PUBLIC_WEBSITE_ORIGIN`    | Bare origin of the public website                                                                     | QR codes point at the wrong site. Plain `http` is accepted only for localhost outside Vercel production.                                                                                                                                                          |

### Storage variables

See [Storage](storage.md#configuration-modes). In short:

- SQU verification evidence falls back to the database only when **all five** membership
  variables are empty; a partial configuration refuses SQU verification submissions (503).
  Membership applications upload no file since 0033 and work in every mode;
- covers, project images and photos need the four shared variables plus their own bucket;
- every bucket must be private and distinct.

### Feature switches

`MEMBER_PHOTO_UPLOADS=disabled` refuses photo uploads with 403 `UPLOADS_DISABLED`. Deleting a photo
stays allowed. `MEMBER_PROFILE_EDITING=disabled` refuses the full profile edit with 403
`EDITING_DISABLED`. Saving a phone number for event registration stays allowed. `GET /v1/me/profile`
reports both as `features`, and the website hides the controls when either side disables them.

### Development Cycle 2 (ADR 0025)

Migrations 0033–0035 add **no environment variable**. The limits and the evidence retention period
are rows in `private.verification_settings` and `private.organizational_positions`, changed by
holders of `settings.verification` (initially Board Administration, Technical and Society
Affairs, ADR 0027) on Membership → Leadership or SQU verification, not through the environment:

| Setting                                      | Default                                                 | Range                                               |
| -------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `squ_submissions_per_30_days`                | 3                                                       | 1–20                                                |
| `leadership_requests_per_30_days`            | 5                                                       | 1–50                                                |
| `max_active_appointments_per_member`         | `NULL` (no limit; one position per team always applies) | 1–20, or `NULL`                                     |
| `document_retention_days`                    | `NULL` (off)                                            | 30–3,650, or `NULL`                                 |
| Holders per position per team                | 1 for each                                              | 1–50, or `NULL` (no limit)                          |
| Holders per position, committee level (0035) | Starts equal to the team limit (1 each)                 | 1–50, or `NULL` (no limit)                          |
| `leadership_requests_open` (0034)            | `true` (open)                                           | `settings.verification`, on Membership → Leadership |

Zero is not accepted for any limit. An empty retention period means "not configured": evidence is
kept. Setting or shortening it so that stored evidence becomes eligible for deletion needs an
explicit confirmation (`RETENTION_CONFIRMATION_REQUIRED`); saving deletes nothing.

### Email Centre (ADR 0028)

Sending stays **off** until all of these are set; drafts, audiences and previews work without
them. The provider and sender address are deferred by the owner, so no environment sets them yet.

| Variable                   | Meaning                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EMAIL_TRANSPORT`          | The adapter. Only `test` exists (recording adapter, refused in production). A provider adapter is added in `lib/email/transport.ts` once chosen.       |
| `EMAIL_FROM`               | The sender, for example `Engineering Society <announcements@example.test>`. Must be a verified address at the chosen provider.                         |
| `EMAIL_UNSUBSCRIBE_SECRET` | At least 32 characters; signs the one-click unsubscribe links. Rotating it invalidates the links in messages already sent.                             |
| `EMAIL_DISPATCH_SECRET`    | At least 32 characters; authorizes `POST /v1/internal/email-dispatch` (`CRON_SECRET`, as Vercel Cron sends it, is accepted instead).                   |
| `EMAIL_TEST_OUTBOX`        | Test adapter only: a file that receives each message as one JSON line (the browser harness uses it).                                                   |
| `APP_ORIGIN`               | Already used; the base of the unsubscribe links (`/v1/email/unsubscribe`). Without it messages carry no unsubscribe link, so set it before going live. |

None of them is a provider credential yet. When a provider is chosen, its API key is one more
server-only variable read only by its adapter.

## API clients and keys

The website's `CORE_EVENTS_API_KEY` is **not configured in Core's environment**. It is a row in
`private.api_clients` of the database that Core uses
([`docs/api/PRODUCTION_CUTOVER_RUNBOOK.md`](../api/PRODUCTION_CUTOVER_RUNBOOK.md) §B):

1. Generate a token `essq_test_<prefix>_<secret>` (staging) or `essq_live_<prefix>_<secret>`
   (production):
   - the prefix is 8–40 characters from `[a-z0-9_]`;
   - the secret is at least 32 base64url characters, for example from `openssl rand -base64 48`
     with `+` and `/` removed or replaced.
2. Compute `sha256(full token)` in hex.
3. As a privileged database operator (not `app_runtime`), insert the row:

   ```sql
   insert into private.api_clients (name, key_prefix, key_hash, environment, scopes, active)
   values ('<client name>', '<prefix>', '<sha256 hex>', 'staging', '{events:read}', true);
   ```

   Use `environment` `staging` for `essq_test_` tokens and `production` for `essq_live_` tokens.
   A mismatch makes every request 401.

4. Store the raw token only as the website's `CORE_EVENTS_API_KEY` secret in the matching Vercel
   scope. It is shown once and never stored in Core.

**Rotate** by creating a second client, deploying the website with it, then revoking the old
one: `update private.api_clients set active = false, revoked_at = now() where key_prefix = '…'`.
Revocation takes effect immediately. A token copied from another environment fails unless its
exact hash exists in this database with the right environment.

## Tests, scripts and CI

| Variable                                                                                                                                                                                | Used by                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL`                                                                                                                                                                     | `npm test` and the browser suites: a loopback PostgreSQL 17 database whose name contains `uc02_test`. Without it, the global setup starts a Docker container. |
| `UC02_TEST_APP_RUNTIME_DATABASE_URL`, `UC02_TEST_APP_MAINTENANCE_DATABASE_URL`, `UC02_TEST_*` IDs, `UC02_TEST_CONTAINER_NAME`                                                           | Set by the test global setup; not for manual use                                                                                                              |
| `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`                                                                                                                                     | `npm run test:integration` (live staging anon RLS checks); CI repository **variables**                                                                        |
| `STAGING_M5_MANAGER_EMAIL`, `STAGING_M5_MANAGER_PASSWORD`, `RUN_STAGING_MANAGER_AUTH_TESTS`                                                                                             | Opt-in staging manager sign-in test                                                                                                                           |
| `MEMBERSHIP_S3_TEST_*`, `EVENT_FLOW_PRODUCTION`, `EVENT_FLOW_BROWSER_CHANNEL`                                                                                                           | Storage and two-app browser harnesses (`EVENT_FLOW_BROWSER_CHANNEL=chrome` uses installed Chrome)                                                             |
| `CORE_HTTP_E2E_URL`, `CORE_HTTP_E2E_READ_KEY`, `CORE_HTTP_E2E_NO_SCOPE_KEY`, `CORE_HTTP_E2E_OIDC_TOKEN`, `CORE_HTTP_E2E_LANDING_OIDC_TOKEN`, `STAGING_PROJECT_REF`, `SUPABASE_CLI_PATH` | `scripts/staging-api-http-e2e.mjs` and helpers (live staging HTTP checks; see `docs/api/STAGING_HTTP_E2E.md`)                                                 |
| `M6_REVIEW_PORT`, `M6_REVIEW_CHECK_ONLY`                                                                                                                                                | `scripts/m6-local-review.ts`                                                                                                                                  |

CI's build step uses dummy `NEXT_PUBLIC_SUPABASE_*` and `APP_RUNTIME_DATABASE_URL` values. The
release gate skips outside Vercel.

## Per-environment checklist

| Variable                    | Local                                             | Preview                                   | Production                                                                             |
| --------------------------- | ------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_*`    | Staging project (README) or a local stack         | Staging project                           | Production project                                                                     |
| `APP_RUNTIME_DATABASE_URL`  | Staging `app_runtime` or a local database         | Staging `app_runtime`                     | Production `app_runtime` (pooler, TLS)                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | Not needed for public work                        | Only if testing user administration       | Required (sensitive)                                                                   |
| `CORE_API_ALLOWED_ORIGINS`  | `http://localhost:3000` (website origin)          | The website's Preview origin              | `https://essqu.com`, `https://www.essqu.com`, `https://essqu-web.vercel.app` as served |
| `APP_ORIGIN`                | Optional                                          | The Preview origin, if exports are tested | The dashboard's canonical origin                                                       |
| `AUTH_REDIRECT_ORIGIN`      | `http://localhost:3000` (staging allow-list only) | The Preview origin, if recovery is tested | The production dashboard origin                                                        |
| `PUBLIC_WEBSITE_ORIGIN`     | The local website origin                          | The website's Preview origin              | `https://essqu.com`                                                                    |
| `SUPABASE_S3_*`             | Staging buckets or unset                          | Staging buckets                           | Production buckets, each private                                                       |

**Deployed** (2026-10-24, read-only): the client JavaScript served by
`https://engsoc-platform.vercel.app`, `https://admin.essqu.com` and `https://api.essqu.com`
references the Supabase project ID that [`docs/CURRENT_WORK.md`](../CURRENT_WORK.md) records as
**staging**. `GET https://api.essqu.com/v1/health` reported a database at schema 32 or newer, while
the same document records production's database at migration 0024. **Inferred:** the production
deployment currently uses the staging Supabase project and database. Confirm with the owner; see
[Known gaps](../known-gaps.md#unverified-infrastructure-settings).
