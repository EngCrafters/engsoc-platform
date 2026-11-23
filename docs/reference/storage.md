# Storage

Core keeps files in **private Supabase Storage buckets** and talks to them through Storage's
S3-compatible API, signing each request with AWS Signature Version 4 on the server
([`lib/membership/storage.ts`](../../lib/membership/storage.ts), `signRequest`). There are no
public buckets, no signed URLs and no Storage RLS policies in use: every file reaches a browser
only through an authenticated or visibility-checked Core route (ADR 0018). Bucket names and keys
come from environment variables (**Source**). The buckets' existence and privacy settings in each
Supabase project are **Unknown** here, apart from Core's own records (`docs/CURRENT_WORK.md`
records a private `member-photos` bucket on staging).

## Buckets

| Purpose                     | Bucket variable                   | Object keys                                           | Written by                                                         | Read through                                                                    |
| --------------------------- | --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Legacy application ID cards | `SUPABASE_S3_MEMBERSHIP_BUCKET`   | `membership-id-cards/<uuid v4>.(jpg\|png\|webp\|pdf)` | Nothing since 0033 (previously `POST /v1/membership-applications`) | `GET /admin/membership/{id}/document` (reviewers only, audited)                 |
| SQU verification evidence   | `SUPABASE_S3_MEMBERSHIP_BUCKET`   | `squ-verification/<uuid v4>.(jpg\|png\|webp\|pdf)`    | `POST /v1/me/verification/squ`                                     | `GET /admin/membership/verifications/{id}/document` (reviewers only, audited)   |
| Event covers                | `SUPABASE_S3_EVENT_BUCKET`        | `event-covers/<uuid>.(jpg\|png)`                      | Dashboard `saveEventAction`                                        | `GET /v1/events/{id}/image` (public events); `GET /admin/events/{id}/image`     |
| Project images              | `SUPABASE_S3_PROJECT_BUCKET`      | `project-images/<uuid>.(jpg\|png)`                    | `POST /v1/me/projects/{id}/media`                                  | `GET /v1/projects/{id}/media/{media}`; `GET /admin/projects/{id}/media/{media}` |
| Member photos               | `SUPABASE_S3_MEMBER_PHOTO_BUCKET` | `member-photos/<uuid>.jpg`                            | `PUT /v1/me/profile/photo`                                         | `GET /v1/me/profile/photo` (owner only)                                         |

The buckets share the endpoint, region and access keys: `SUPABASE_S3_ENDPOINT`,
`SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID` and `SUPABASE_S3_SECRET_ACCESS_KEY`. Each feature
refuses to start when its bucket equals another feature's bucket.

## Configuration modes

`documentStorageMode()` resolves the five membership variables:

| Mode            | When                     | Effect                                                                                                                                                  |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`      | All five are empty       | SQU verification evidence is stored as `bytea` in `private.squ_verification_documents` (as ID cards were in `private.membership_documents` before 0033) |
| `storage`       | All five set and valid   | Evidence goes to the bucket                                                                                                                             |
| `misconfigured` | Some set, or any invalid | SQU verification submissions are refused (503). The problem variable **names** are logged once as `membership_storage_misconfigured`.                   |

Since migration 0033 (ADR 0025), membership applications upload no file, so registration works in
every mode.

Validation rules:

- **Endpoint:** `https`; plain `http` only for a loopback host when not on Vercel. No credentials,
  query or fragment.
- **Region:** `[a-z0-9-]{2,32}`.
- **Access key ID:** `[A-Za-z0-9_-]{8,128}`.
- **Secret:** at least 8 characters with no whitespace.
- **Bucket:** `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`.

Event covers, project images and member photos reuse the same resolver with their own bucket
variable, so they also need the four shared variables. Unlike verification evidence, they have no
database fallback: without storage, uploads fail and image routes return 503 or 404.

## Upload processing

| File type     | Limits                                                        | Processing                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQU evidence  | ≤ 4 MiB; JPEG, PNG, WebP or PDF by file signature             | Stored byte for byte with its SHA-256, checked again on every read. PDFs with active content are refused ([`lib/membership/document.ts`](../../lib/membership/document.ts)).          |
| Event cover   | ≤ 3 MiB; JPEG or PNG (declared type and signature must agree) | `sharp`: auto-rotate, resize to at most 2400 px wide, re-encode (JPEG quality 88 or PNG), metadata dropped ([`lib/event-management/images.ts`](../../lib/event-management/images.ts)) |
| Project image | ≤ 3 MiB; JPEG or PNG                                          | The same processing as covers, under the `project-images/` prefix ([`lib/projects/storage.ts`](../../lib/projects/storage.ts))                                                        |
| Member photo  | ≤ 3 MiB; JPEG or PNG                                          | `sharp`: 512 × 512 cover crop ("attention" position), JPEG ([`lib/members/photos.ts`](../../lib/members/photos.ts))                                                                   |

Read paths check content type and size again: covers and project images at most 3 MiB, member
photos `image/jpeg` only.

## Deletion

Files are never deleted in a way that could leave the database pointing at a missing object:

- **Replacing** an event cover or member photo uploads the new object first, saves the new key,
  then deletes the old object. If the database write fails, the new object is deleted.
  "Uncertain" failures keep the object rather than risk a broken reference.
- **Removing a project image** (`DELETE /v1/me/projects/{id}/media/{media}`) deletes the row,
  then the object. Images used by the working or published snapshot cannot be removed.
- **The deletion queue.** Database-driven removals write a row to
  `private.membership_storage_deletions` in the same transaction as the reference removal:
  - a legacy ID card deleted at approval or rejection (trigger `membership_document_removed`);
  - an abandoned ID-card upload (`queue_abandoned_membership_upload`) or SQU evidence upload
    (`queue_abandoned_verification_upload`);
  - SQU evidence past the retention period (`purge_expired_verification_documents`). This happens
    only once Technical sets a period; until then, evidence is kept after the decision;
  - a member's evidence removed with their record or account (ADR 0024);
  - a permanent deletion of an event, project or member (0032; `reason = 'record_deleted'`, with
    the bucket passed in by the server).
- **Draining the queue.** `processMembershipStorageDeletions()` claims items
  (`claim_membership_storage_deletions`), deletes each object with the S3 credentials and the
  queued bucket name, and marks it done (`complete_membership_storage_deletion`). A failure leaves
  the item queued; an already-missing object counts as deleted. There is **no scheduled job**. The
  queue runs from `after()` callbacks:
  - when a reviewer opens `/admin/membership`;
  - after a membership decision;
  - after the retention cleanup, which runs (25 documents at most) when a reviewer opens
    `/admin/membership/verifications`, and after Technical saves the verification settings;
  - after a permanent deletion (up to 25 items).

  It returns early unless the **membership** storage configuration is complete, even for queued
  event, project or photo objects (see [Known gaps](../known-gaps.md)).

## Operational checks

- Each bucket must exist, be **private** (`public = false`), and be distinct from the others.
- Never reuse the membership bucket for anything but ID cards and SQU verification evidence.
- Migration 0033 deletes no existing object. Legacy `membership-id-cards/` objects follow their
  existing rules.
- Never expose the S3 keys or the bucket through `NEXT_PUBLIC_*`.
- To see queue backlog without file names, as an operator with database access, count rows in
  `private.membership_storage_deletions` where `completed_at IS NULL`.
