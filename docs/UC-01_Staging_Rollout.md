# UC-01 membership: staging rollout runbook (0025 and 0026, private Storage)

Status (October 20, 2026, Dubai): **steps 1–3 done on staging with the owner's approval.** Every
step that changes staging needs the owner's explicit approval. Production is a separate rollout
with separate authorization; nothing has been applied there.

| Step                    | State on staging                                                          |
| ----------------------- | ------------------------------------------------------------------------- |
| 1. Pre-checks           | Re-run immediately before applying; all as listed                         |
| 2. 0025, 0026           | Applied; versions `20261020170444` and `20261020170445`                   |
| 3. Post-flight          | All as listed; registrations 5 and `register_for_event` md5 unchanged     |
| 4. Rotate keys          | Owner reports the pair in the developer's `.env.local` is the rotated one |
| 5. Restrict bucket `v1` | **Not done** (no size or MIME limit yet)                                  |
| 6. Configuration        | Developer `.env.local` only; **not on Vercel**                            |
| 7. Smoke test           | **Not run**                                                               |

How step 2 was done: the Supabase MCP was not available, so each committed file (hashes as in
section 2) was sent unchanged in its own transaction over the developer's staging connection.
Each history row (`statements` = the file, `created_by` empty) was inserted in the same
transaction. A read-only signed GET of a nonexistent object then returned 404 from the real
bucket, which confirms the keys, region, bucket and signature.
Decisions: [ADR 0017](adr/0017-membership-applications-and-review.md),
[ADR 0018](adr/0018-membership-id-cards-in-private-storage.md). Contract:
[UC-01_Membership_Applications.md](UC-01_Membership_Applications.md).

Target: staging project `wnrdgnmmcdedmilnzzsl`. Branch `feat/uc01-membership-applications`.

## 0. Approvals this runbook needs

| Step                                                      | Changes                     | Approval      |
| --------------------------------------------------------- | --------------------------- | ------------- |
| 2. Apply 0025, then 0026                                  | staging database            | required      |
| 4. Rotate the S3 keys                                     | staging Storage credentials | owner does it |
| 5. Restrict bucket `v1` (size and types)                  | staging `storage.buckets`   | required      |
| 6. Install Storage variables (local and Vercel staging)   | configuration               | required      |
| 7. Smoke test (one synthetic application, then rejection) | staging data and Storage    | required      |
| Destructive rollback (section 9.4)                        | staging database            | required      |

## 1. Pre-checks (read-only; last run on staging 2026-10-20, all as expected)

Run inside `BEGIN READ ONLY; … ROLLBACK;`.

```sql
-- Latest migration is 0024 (staging: version 20261018192230).
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;
-- Nothing from 0025/0026 exists yet: all true.
SELECT to_regclass('private.membership_applications') IS NULL AS applications_absent,
       to_regclass('private.membership_storage_deletions') IS NULL AS queue_absent,
       to_regprocedure('private.get_membership_review_overview(uuid)') IS NULL AS routines_absent;
-- Dependencies: roles (0004/0010), access hierarchy (0016), auth bridge (0017), members.
SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles
  WHERE rolname IN ('app_runtime', 'app_maintenance', 'uc02_routine_owner');   -- all three
SELECT to_regclass('public.administrative_access') IS NOT NULL,
       to_regclass('private.access_auth_users') IS NOT NULL,
       to_regclass('public.members') IS NOT NULL;                               -- true, true, true
SELECT count(*) FROM public.committees WHERE slug = 'society-affairs';          -- 1
-- 0025 replaces the audit CHECK; it must still be 0021's list.
SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint
  WHERE conname = 'uc02_audit_action_check';                    -- b9dadd8d6bb09e2ae492c4c3897d99e6
-- Baselines to compare after applying.
SELECT count(*) FROM public.registrations;                                      -- staging: 5
SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.register_for_event'::regproc;
                                                                -- staging: 65b55b4e3d1b7ce82c03e9b8f70a1ac2
SELECT count(*) FROM public.members;                                            -- staging: 0
-- The bucket is private and unrestricted by policy (staging: v1, false, 0 objects, 0 policies).
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'v1';
SELECT count(*) FROM storage.objects WHERE bucket_id = 'v1';
SELECT count(*) FROM pg_policies WHERE schemaname = 'storage';
```

## 2. Apply (after approval)

Apply the files byte for byte, in order, as **two** separate requests through the method used for
0024: the Supabase MCP `apply_migration`, each request being `BEGIN;` + the unchanged file +
`COMMIT;`. Add no other SQL. Each file ends with its own DO-block self-check; any failure rolls
that whole migration back.

| Order | Migration name                     | SHA-256 of the file at commit `3effcdb`                            |
| ----- | ---------------------------------- | ------------------------------------------------------------------ |
| 1     | `0025_membership_applications`     | `058778f264cc3f5bdedf7a13bce40486ca216d49054f2a405b0add289bcb1004` |
| 2     | `0026_membership_document_storage` | `ee578a6205230fb6f83908cc89d88225c24dc56588a112f0f55d037f85105875` |

Both are additive:

- new private tables, routines, a trigger and an index;
- a wider audit CHECK (0025);
- `SELECT`/`INSERT` on `public.members` for the routine owner (0025);
- a nullable `content` column, which is safe while the table is empty (0026);
- a replaced `get_membership_document` with a longer result (0026).

There are no existing-row updates or deletes. Both were rehearsed from scratch on PostgreSQL 17 with
the full migration chain.

## 3. Post-flight (read-only)

```sql
-- Five tables, forced RLS, owned by the routine owner.
SELECT c.relname, c.relrowsecurity AND c.relforcerowsecurity AS forced, c.relowner::regrole
FROM pg_class c WHERE c.relnamespace = 'private'::regnamespace
  AND c.relname LIKE 'membership%' AND c.relkind = 'r' ORDER BY 1;
-- No login or browser role holds a table privilege: 0.
SELECT count(*) FROM information_schema.role_table_grants
WHERE table_schema = 'private' AND table_name LIKE 'membership%'
  AND grantee IN ('app_runtime', 'app_maintenance', 'anon', 'authenticated', 'service_role');
-- 16 runtime routines; the 4 helpers (membership_actor_email, membership_invalid_field,
-- membership_reviewer_kind, queue_removed_membership_document) runtime = false; browser = false for all.
SELECT p.proname, has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime,
       has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE') AS browser
FROM pg_proc p WHERE p.pronamespace = 'private'::regnamespace AND p.proname LIKE '%membership%'
ORDER BY 1;
-- Deletion trigger enabled ('O'); approval policy still unset (NULL).
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'private.membership_documents'::regclass AND NOT tgisinternal;
SELECT approval_policy FROM private.membership_settings;
-- Baselines unchanged: same registration count, same register_for_event md5, members 0.
```

Then, signed in as the Society Affairs manager, the Core dashboard shows **Membership
applications** without the "Setup" badge, as an empty list with the "Final approval is not enabled
yet" notice. A manager of another committee still sees no Membership section.

## 4. Rotate the S3 keys (owner)

The original key pair was exposed outside the environment. In the Supabase dashboard (project
`wnrdgnmmcdedmilnzzsl`), go to Project Settings → Storage → S3 Connection:

1. **Revoke** the exposed key.
2. Create a new key pair.
3. Put the new secret straight into the two places in step 6. Never send it in chat, a ticket, a
   commit or a log.

## 5. Restrict bucket `v1` (after approval)

The bucket stays private. As defence in depth, limit uploads to what Core accepts, either in the
Dashboard (Storage → `v1` → Edit bucket) or with:

```sql
UPDATE storage.buckets
SET file_size_limit = 4194304,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'v1' AND public = false;           -- 1 row; public stays false
```

Do not add any `storage.objects` policy for this bucket. Core reads and writes only with the S3
keys, and no browser role should ever reach these objects.

## 6. Install the configuration (after approval)

Server-only, never `NEXT_PUBLIC_`, never committed. Set the two keys as **Sensitive** on Vercel.
Scope them to the staging/Preview environment first. Production gets its own bucket and keys later.

```text
SUPABASE_S3_ENDPOINT=https://wnrdgnmmcdedmilnzzsl.storage.supabase.co/storage/v1/s3
SUPABASE_S3_REGION=ap-northeast-1
SUPABASE_S3_ACCESS_KEY_ID=<rotated key id>
SUPABASE_S3_SECRET_ACCESS_KEY=<rotated secret>
SUPABASE_S3_MEMBERSHIP_BUCKET=v1
```

Set all five or none:

- none set: ID cards stay in PostgreSQL;
- some set: Core refuses submissions and logs the missing variable names once.

## 7. Smoke test on staging (after approval)

1. From the staging website, submit one application with a synthetic identity and a **generated**
   card image, never a real ID card.
2. `SELECT count(*) FROM storage.objects WHERE bucket_id = 'v1' AND name LIKE 'membership-id-cards/%';`
   should return 1. The application's document row has `content IS NULL` and a matching
   `storage_key`.
3. As the Society Affairs manager, open the application, reveal the card (it displays), then
   reject it with a note.
4. Within a minute, the object count is back to 0 and the queue row has `completed_at` set:
   `SELECT reason, completed_at FROM private.membership_storage_deletions;`
5. The audit holds `membership.submitted`, `membership.document_viewed` and `membership.rejected`
   for that application ID, and no personal data.

The rejected synthetic application remains as a permanent record. Use an obviously synthetic name.

## 8. Ongoing checks (read-only)

```sql
-- Deletions waiting longer than an hour (normally 0; each review action and list visit retries).
SELECT count(*) FROM private.membership_storage_deletions
WHERE completed_at IS NULL AND requested_at < now() - interval '1 hour';
-- Orphans: membership objects with no document and no queue entry (normally none).
SELECT o.name, o.created_at FROM storage.objects o
WHERE o.bucket_id = 'v1' AND o.name LIKE 'membership-id-cards/%'
  AND o.created_at < now() - interval '1 hour'
  AND NOT EXISTS (SELECT 1 FROM private.membership_documents d
                  WHERE d.storage_bucket = o.bucket_id AND d.storage_key = o.name)
  AND NOT EXISTS (SELECT 1 FROM private.membership_storage_deletions q
                  WHERE q.storage_bucket = o.bucket_id AND q.storage_key = o.name);
```

## 9. Recovery and rollback

1. **Storage misbehaving:** set all five variables to empty and redeploy. New ID cards then go to
   PostgreSQL (0025's path), and nothing else changes. Storage-backed cards of applications still
   undecided cannot be displayed (503) until the variables return. Decide or keep those first.
2. **Code:** redeploy the previous Core. 0025 and 0026 are additive, and earlier code never calls
   the new routines.
3. **Orphans or a stuck queue:** queue an orphan found in section 8 with
   `SELECT private.queue_abandoned_membership_upload('v1', '<object name>');`. This is a write, so
   it needs approval. The routine refuses any object a document references. Opening the membership
   list as a reviewer processes the queue.
4. **Destructive schema rollback (last resort, approval required):**
   `db/rollback/0026_0025_membership_rollback.sql`, inside `BEGIN; … COMMIT;`.
   - Its guard refuses to run once any application, pending Storage deletion or membership audit
     row exists, because those are permanent records.
   - It was verified locally to restore the **exact** post-0024 catalog: functions, tables,
     privileges, RLS flags, constraints, indexes, policies, triggers and types. Its audit CHECK is
     the definition staging has now (md5 `b9dadd8d…`).
   - Afterwards, delete the two `supabase_migrations.schema_migrations` rows.
