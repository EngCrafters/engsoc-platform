# Staging rollout: migrations 0027–0030, storage and runtime role

Prepared October 21, 2026. Production follows separately, after its own approval.

**Applied to staging on October 21, 2026, with the owner's authorization.**

- **Backup first.** Before any write, a `pg_dump` of `public`, `private`, `supabase_migrations` and
  `storage.buckets` was kept locally (not in the repository).
- **No drift.** Staging's schema was identical to a local replay of 0000–0026, so the rehearsal
  below represents it exactly.
- **Migrations.** 0027–0030 applied one transaction each, with history versions
  `20261021060200`, `…202`, `…204` and `…207`. Their SHA-256 checksums matched the rehearsed
  files.
- **Post-flight.** Every row count was unchanged, as was the approval policy. Schema version is
  30, grants are correct, and row-level security is forced everywhere.
- **Buckets.** Private `event-covers` and `project-images` were created (3 MiB, JPEG/PNG, no
  browser policies). `v1` is unchanged.
- **Runtime role.** The staging `app_runtime` password was rotated and validated as a restricted
  login, then installed only in the developer's local `.env.local`. Any other environment that
  used the old staging value needs the new one.
- **End-to-end on staging:** 16 of 16 checks passed, through the local Core dashboard and
  ESWebsite, with synthetic accounts that were removed afterwards:
  - events with and without an image, with the image shown on the website;
  - an application approved and activated without an invitation;
  - the member's status after sign-in;
  - a project submitted, reviewed and published;
  - another committee's manager and a non-admin member refused.

Before the rollout, staging ended at `0026_membership_document_storage` (read-only check, October
21). The deployed Core branch needs 0027–0030. Without them:

- `GET /v1/me/membership` fails, which shows members "Your membership status couldn't be loaded";
- `GET /v1/events` and the admin event pages fail.

## 1. Migrations (approval 1)

Apply in order, one request per file, each `BEGIN;` + the unchanged file + `COMMIT;` with its
history row, as for 0025/0026 (`UC-01_Staging_Rollout.md` step 2). Every file ends with a DO-block
self-check, so any failure rolls that migration back whole.

| Order | Migration                                | What it changes                                                                                                                         |
| ----- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `0027_membership_member_accounts`        | Nullable `auth_user_id`; applicant status routine; activation requires a confirmed identity (ADR 0019)                                  |
| 2     | `0028_event_media_and_attendance`        | Event cover/phone options, private member phone, check-in sessions, member registration and attendance routines (ADR 0020)              |
| 3     | `0029_member_projects`                   | Private project tables and routines (ADR 0021)                                                                                          |
| 4     | `0030_attendance_reliability_and_limits` | Per-minute check-in codes, verified guest linking, manual attendance, per-member limits, rate-limit purge, schema version 30 (ADR 0022) |

**Effect on existing data.** No existing row is changed except:

- 0030 deletes rate-limit attempts older than an hour as registrations arrive, as UC-02 data
  design section 5 always intended (staging holds 18, some older than a day);
- a guest registration gains its member's ID when that member, signed in with the same confirmed
  email, opens or registers for the event (audited).

Nothing is deleted from members, applications, events, registrations or audit.

**Rehearsal.** A disposable PostgreSQL 17 database was built to 0026 and seeded with synthetic
data in staging's shape:

- 1 approved and activated member;
- 3 published events and 1 draft;
- 5 guest registrations (4 confirmed, 1 waitlisted), one of them with the member's email;
- 18 rate-limit attempts, some older than a day.

0027–0030 were then applied one transaction each, and 18 of 18 checks passed:

- every existing row unchanged;
- the member's status loads;
- the earlier guest registration linked;
- two screens showed one code;
- QR and manual check-in worked;
- a full event still refused;
- old attempts were purged;
- browser roles had no access.

**Recovery.** The four migrations are additive except 0030's column swap on
`event_checkin_sessions`, a table that is empty on staging. Take a schema-and-data dump first
(`pg_dump --schema=public --schema=private`). The recovery path is a forward fix; restoring the
dump is the last resort.

**Post-flight (read-only):**

```sql
SELECT private.core_schema_version();                                                       -- 30
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 4; -- 0030..0027
SELECT has_function_privilege('app_runtime', 'private.get_my_membership(uuid)', 'EXECUTE');    -- true
SELECT has_function_privilege('app_runtime', 'private.record_manual_attendance(uuid,uuid,uuid,boolean,text)', 'EXECUTE'); -- true
SELECT has_function_privilege('authenticated', 'private.confirm_member_attendance(uuid,uuid,text)', 'EXECUTE');          -- false
SELECT count(*) FROM pg_class WHERE relnamespace = 'private'::regnamespace AND relkind = 'r'
  AND NOT (relrowsecurity AND relforcerowsecurity);                                          -- 0
SELECT count(*) FROM public.registrations;                                                   -- unchanged (5 on Oct 21)
```

Then `GET <core>/v1/health` returns `{"data":{"status":"ok"}}`.

## 2. Storage buckets (approval 2)

Event covers and project images need private buckets separate from ID cards (`v1`); Core refuses
to share them. Create both private, with limits matching what Core accepts, and add **no**
`storage.objects` policies:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('event-covers',   'event-covers',   false, 3145728, ARRAY['image/jpeg', 'image/png']),
  ('project-images', 'project-images', false, 3145728, ARRAY['image/jpeg', 'image/png']);
UPDATE storage.buckets
SET file_size_limit = 4194304,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'v1' AND public = false;   -- still open from the 0026 rollout
```

## 3. Configuration (approval 3)

**Core:**

- `SUPABASE_S3_EVENT_BUCKET=event-covers`
- `SUPABASE_S3_PROJECT_BUCKET=project-images`
- `PUBLIC_WEBSITE_ORIGIN=<website origin>`, which the attendance QR codes point at;
- `CORE_API_ALLOWED_ORIGINS` including the website origin.

**Website:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORE_API_BASE_URL`.

**Runtime role.** `APP_RUNTIME_DATABASE_URL` must log in as `app_runtime`, never `postgres`. The
configured local URL for staging logs in as `postgres`, which bypasses every row-level policy.
Production was switched to a rotated `app_runtime` password in September. On Vercel the release
gate now fails a production build that connects with a privileged role, and warns on preview
builds.

`app_runtime` is validated for every API operation:

- the database suites run every routine as `app_runtime` (597 tests);
- both browser suites run both apps on it;
- the staging rehearsal granted nothing else.

**Supabase Auth** (`AUTH_AND_EMAIL.md` section 9):

- minimum password length 8;
- the website `/login` and `/reset-password` redirect URLs;
- the token-hash email templates;
- a custom SMTP rate limit sized for sign-up drives: the documented 30 per hour is too low for
  orientation week.

## 4. Smoke test (approval 4)

Synthetic accounts and an event created for the test, removed afterwards:

1. `/v1/health` returns ok.
2. A member signs in and their status loads.
3. Create an event with a cover and a link, and register as a member.
4. Open check-in on two screens: both show the same code, and the member confirms.
5. Check in a guest manually, then undo it.
6. Export the attendance CSV.
7. A foreign manager is refused.
8. Submit, review and publish a project.
