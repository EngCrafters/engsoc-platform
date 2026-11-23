# Operations

Deploying, observing, troubleshooting and maintaining Core. Procedures marked **unverified** are
proposals that the repository does not record as tested.

## Deployment

- **Path.** Vercel's GitHub integration deploys the Core project. A push or merge to `main` creates
  a **Production** deployment; other branches create Preview deployments, such as the `staging`
  branch alias recorded in `docs/CURRENT_WORK.md` (ADR 0001, ADR 0007, `CLAUDE.md`). Vercel's
  project settings are not in the repository (**Unknown** beyond these documents).
- **Documented workflow versus recent history.** ADR 0007 describes direct commits to `main`. The
  recent history merges pull requests through `staging` into `main` (PRs #12–#14; **Source**:
  `git log`).
- **CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) validates pushes and pull
  requests to `main`. It does not deploy.
- **Release gate.** On Vercel Production, `npm run build` stops with an explicit message when:
  - `APP_RUNTIME_DATABASE_URL` is missing or unreachable;
  - the runtime role bypasses RLS;
  - the database's `private.core_schema_version()` is lower than the journal's highest migration.

  So **migrate the target database first, then deploy the code**.

- **After every deployment:**
  1. GitHub Actions is green, and the Vercel deployment is Ready.
  2. `GET <host>/v1/health` returns `{"data":{"status":"ok"}}`.
  3. `GET <host>/v1/events` without a key returns 401 with `WWW-Authenticate: Bearer`, which shows
     the route is live and authentication is enforced.
  4. `/admin/login` renders. Sign in with a pilot account only if authorized.
  5. If the website depends on a change, check its pages too.

**Deployed** (2026-10-24, read-only): `https://api.essqu.com/v1/health` returned `ok`. `/v1/events`
without a key returned 401 `Bearer`. `/v1/projects` returned `SUCCESS`. `/admin/login` responded
200 on `engsoc-platform.vercel.app`, `admin.essqu.com` and `api.essqu.com`.

## Rollback

- **Code:** promote the previous Ready deployment in Vercel (Deployments → Promote / Instant
  Rollback). This is **unverified for this project**. A code rollback must stay compatible with
  the current database. Rolling back past a migration the old code does not expect is safe only
  when the migration was additive, which recent ones are.
- **Database:** migrations are forward-only. Recovery means restoring a logical backup taken
  before the change (see below) or writing a forward fix. The only rollback script is the
  last-resort `db/rollback/0026_0025_membership_rollback.sql`.

## Backups and restore

What the repository records (`docs/CURRENT_WORK.md`, `docs/Platform_Maintenance_Runbook.md`):

- The Supabase organization is on the **Free plan**. An authenticated inspection found no managed
  backups and PITR disabled. WAL archiving alone was explicitly **not** treated as a usable
  backup.
- The proven recovery artifact is a **logical dump** (`pg_dump` custom format) taken before a
  change. It was verified with `pg_restore --list` and a full decode, and in one case restored
  into an isolated database to rehearse a migration.
- Dumps contain personal data. Store them outside the repository, encrypted where possible, and
  delete them when no longer needed.

The procedure is **unverified as a routine**:

1. `pg_dump --format=custom` with the owner connection.
2. `pg_restore --list` to check the archive.
3. Restore into a disposable PostgreSQL 17 to prove it.

Restoring over a live project would need the owner's approval and a maintenance window. No such
restore is recorded.

## Logs

Vercel function logs carry Core's structured server events. Payloads never contain request
bodies, tokens, emails or SQL messages: they hold an event name, the error class and SQLSTATE,
and sometimes a request ID ([`lib/api/log.ts`](../../lib/api/log.ts)). `schemaMismatch: true`
marks SQLSTATEs that mean the database is older than the code.

| Event                                                                                                                                                                                     | Meaning                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `schema_behind`, `health_check_failed`                                                                                                                                                    | `/v1/health` found an old schema, or no database                                            |
| `membership_storage_misconfigured`                                                                                                                                                        | Partial or invalid `SUPABASE_S3_*` (lists variable **names**); applications are refused     |
| `membership_storage_failed`, `membership_storage_orphan`, `membership_storage_integrity_failed`, `membership_storage_deletions_failed`                                                    | ID-card upload, cleanup, or queue failures                                                  |
| `member_profile_failed`, `member_photo_failed`, `member_events_failed`, `member_registration_failed`, `member_attendance_failed`, `member_change_request_failed`, `own_membership_failed` | `/v1/me/*` failures (503 to the caller)                                                     |
| `event_cover_cleanup_failed`, `project_image_cleanup_failed`, `member_photo_cleanup_failed`                                                                                               | An object could not be removed after a failed or replaced write; the object may be orphaned |
| `checkin_session_failed`, `attendance_list_failed`, `manual_attendance_failed`                                                                                                            | Dashboard attendance operations                                                             |
| `membership_review_unavailable`, `profile_corrections_unavailable`, `profile_correction_failed`                                                                                           | Membership review data unavailable (for example, missing migrations)                        |
| `administration_*_failed`                                                                                                                                                                 | Administration section reads and actions                                                    |
| `auth_admin_audit_failed`, `auth_admin_access_unconfirmed`                                                                                                                                | An Auth Admin action succeeded but its audit or access confirmation failed                  |

The public API echoes `x-request-id` on every response. Ask callers for it to correlate
failures. The website logs Core's request ID in its own `core-api` log lines.

## Troubleshooting

| Symptom                                                   | Likely cause and check                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build fails at "schema check"                  | Read the message: missing runtime URL, unreachable database, a privileged role, or "the database is at migration N, this code needs M". Apply the reviewed migrations to that database (with approval), then redeploy.                                                                                |
| `/v1/health` → 503 `schema-behind`                        | The deployed code is newer than the database. Same fix.                                                                                                                                                                                                                                               |
| `/v1/events` → 401 for the website                        | The website's key is unknown, revoked or expired, or its `essq_test_`/`essq_live_` type does not match the client row's `environment` in **this** database. List clients without hashes: `select id, name, key_prefix, environment, scopes, active, expires_at, revoked_at from private.api_clients;` |
| `/v1/events` → 403                                        | The key lacks `events:read`, or the request carried a disallowed `Origin`                                                                                                                                                                                                                             |
| Website registration, membership or `/me/*` blocked       | `CORE_API_ALLOWED_ORIGINS` is missing the website's exact origin (scheme, host and port). Preflight responses without `access-control-allow-origin` confirm it.                                                                                                                                       |
| `/me/*` → 401 for signed-in website members               | The website's `SUPABASE_URL` is a different project from `NEXT_PUBLIC_SUPABASE_URL`, or the token expired                                                                                                                                                                                             |
| `/me/*` → 503                                             | `NEXT_PUBLIC_SUPABASE_*` unset, Supabase Auth unreachable, or a database failure; check the `member_*_failed` logs                                                                                                                                                                                    |
| Registration → 503 for every visitor                      | No trusted client IP (`x-vercel-forwarded-for` missing, for example outside Vercel in production mode) or a database failure                                                                                                                                                                          |
| Membership application → 503                              | `membership_storage_misconfigured` (partial `SUPABASE_S3_*`), Storage down, or the database                                                                                                                                                                                                           |
| Uploads fail (covers, photos, project images)             | Missing shared S3 variables or bucket, a bucket equal to another feature's bucket, or a non-private or missing bucket in Supabase                                                                                                                                                                     |
| CSV export → 403 "came from another site"                 | `APP_ORIGIN` unset in production, or the dashboard is opened on a different host than `APP_ORIGIN`                                                                                                                                                                                                    |
| Recovery says "temporarily unavailable"                   | `AUTH_REDIRECT_ORIGIN` is unset, or not `https` in production                                                                                                                                                                                                                                         |
| Recovery link → `?link=expired` or `?link=invalid`        | The link was used, expired or pre-opened by a mail scanner; a PKCE link was opened in a different browser; or the redirect is not on the allow-list. See [`AUTH_AND_EMAIL.md`](../AUTH_AND_EMAIL.md) §7.                                                                                              |
| Signed in to the dashboard but "no administrative access" | No active `administrative_access` row (revoked, suspended, never granted), or a committee-scoped grant whose committee lacks a slug                                                                                                                                                                   |
| Account erasure stays "pending"                           | `SUPABASE_SERVICE_ROLE_KEY` is missing, or the Auth deletion failed. Retry from the Administration overview after fixing.                                                                                                                                                                             |
| Queued Storage files never disappear                      | The queue only drains during reviewer activity and deletions, and only when the membership Storage configuration is complete (see [Storage](../reference/storage.md#deletion))                                                                                                                        |

## Routine maintenance

| Task                                                      | How                                                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue, rotate or revoke an API client                     | [Configuration → API clients and keys](../reference/configuration.md#api-clients-and-keys)                                                                                                |
| Rotate the `app_runtime` password                         | `ALTER ROLE app_runtime WITH PASSWORD …` as the owner, then update `APP_RUNTIME_DATABASE_URL` in Vercel and redeploy. The staging rotation is recorded in `STAGING_ROLLOUT_0027_0030.md`. |
| Technical bootstrap or recovery                           | `private.set_technical_access` as `app_maintenance`, following [`Platform_Maintenance_Runbook.md`](../Platform_Maintenance_Runbook.md); never for routine ownership changes               |
| Set the membership approval policy and account activation | Board Administration or Technical (`settings.membership_policy`, migration 0039), on `/admin/membership`                                                                                  |
| Rate-limit rows                                           | Pruned automatically: attempts older than one hour by `purge_rate_limit_attempts`, submission attempts older than one day                                                                 |
| Dependency advisories                                     | `npm audit --omit=dev`; Next.js is pinned at 16.4.2, and the `sharp` and `source-map-js` overrides are in `package.json`                                                                  |

## Production change checklist

1. Owner approval for the specific change and environment.
2. Code merged and CI green.
3. Database:
   1. read-only inspection;
   2. backup;
   3. rehearsal;
   4. migration in one transaction;
   5. post-flight checks.
4. Environment variables set in the right Vercel scope, then a redeploy.
5. Health and smoke checks, and website checks if affected.
6. `docs/CURRENT_WORK.md` updated with what was applied, when and how it was verified.
