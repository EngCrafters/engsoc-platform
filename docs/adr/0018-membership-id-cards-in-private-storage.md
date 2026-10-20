# 0018 — Membership ID cards in private Supabase Storage

Status: accepted for implementation (owner direction, 2026-10-20). Supersedes the section "Where the
ID card lives" of ADR 0017; everything else in ADR 0017 stands.
Related: ADR 0015 (trusted server actor), ADR 0016 (public API), ADR 0017 (membership applications),
`docs/UC-01_Membership_Applications.md`, `docs/UC-01_Staging_Rollout.md`

## Context

ADR 0017 kept SQU ID cards in PostgreSQL (`private.membership_documents.content`) to avoid the
service-role key and orphaned uploads. The owner has since created a private Storage bucket in the
staging project and S3 access keys for it, and directed that ID cards be stored there, with the
database keeping references only.

The staging bucket is `v1`. A read-only check on 2026-10-20 found it private (`public = false`),
empty, with no file-size or MIME restriction, and with no RLS policies on `storage.objects`, so no
anon or authenticated request can read it through the Storage API.

## Decision

### Access path

- Core talks to Storage only through its **S3-compatible API**, with an access key pair held in
  five server-only variables:
  - `SUPABASE_S3_ENDPOINT`
  - `SUPABASE_S3_REGION`
  - `SUPABASE_S3_ACCESS_KEY_ID`
  - `SUPABASE_S3_SECRET_ACCESS_KEY`
  - `SUPABASE_S3_MEMBERSHIP_BUCKET`
- The keys are used in exactly one module, `lib/membership/storage.ts`. It is `server-only`, signs
  each request with AWS Signature Version 4, and never logs, returns or exposes a key, an object URL
  or a response body.
- The service-role key stays confined to `lib/auth/admin.ts`; ADR 0015, precondition 4, is
  unchanged. S3 keys are project-wide and bypass Storage RLS. That makes them as sensitive as the
  service-role key, so they get the same treatment: sensitive Vercel variables, never
  `NEXT_PUBLIC_`, never committed, and rotated if exposed.
- There are no public URLs and no signed URLs. Reviewers receive the bytes through Core's existing
  authenticated document route. The routine re-checks the reviewer and audits the view, then Core
  fetches the object and serves it with the same `no-store` and `nosniff` headers and the same CSP
  as before. Before serving, the bytes must match the size and SHA-256 recorded at submission.

### Submission order

The database cannot call Storage, so the order is chosen to avoid both orphaned rows and
unaccounted objects:

1. `private.begin_membership_submission` records the attempt, applies the five-per-hour limit and
   refuses known duplicates. A refused applicant uploads nothing.
2. Core uploads the object under a random key: `membership-id-cards/<uuid v4>.<ext>`. The extension
   comes from the type the file's own bytes established. The key contains no name, email, student
   ID or original file name.
3. `private.submit_stored_membership_application` revalidates everything and requires a begin from
   the same address in the last ten minutes, so the limit cannot be skipped. Under the unique
   indexes it re-checks duplicates. Then it writes the application, the document reference (bucket,
   key, type, size, SHA-256) and the audit row in one transaction.

Failures:

- An upload that was refused stored nothing.
- An upload that broke off may have stored the object, so the key is queued for deletion.
- If the database refuses after the upload, Core deletes the object, or queues it when the delete
  fails.
- If the database outcome is unknown (an error), Core only queues the key. The queue refuses any
  key a document references, so a committed application can never lose its card.

### Deletion

Deleting a Storage-backed document row is what approval and rejection already do. A trigger on that
deletion queues the object in `private.membership_storage_deletions` in the **same transaction**. A
committed decision can therefore never leave an untracked object.

Core deletes queued objects:

- right after the decision, through Next's `after()`;
- and again whenever a reviewer opens the list.

The queue records each completion. A failed delete stays queued, and an already-deleted object
counts as deleted. Claimed entries are not handed out again for a minute, and an object a document
references is never handed out.

### Transition

Migration `0026_membership_document_storage` is forward-only and leaves 0025 unchanged:

- A document row holds either bytes or a Storage reference, never both, enforced by a CHECK
  constraint.
- With **no** Storage variable set, Core keeps the 0025 PostgreSQL path, so nothing breaks before
  the rotated keys are installed.
- With **some** of them set, submissions are refused rather than stored somewhere unexpected.
- Existing PostgreSQL documents remain readable. No column is dropped.

## Consequences

- PostgreSQL no longer grows with ID card bytes once Storage is configured.
- One more secret pair must be managed and rotated. The original pair was exposed outside the
  environment and must be revoked; only a rotated pair may be installed.
- **Orphan risk:** a process crash between the upload and the database write can leave an object
  with no row and no queue entry. The rollout runbook has a read-only query that finds such objects
  and a call that queues them.
- The bucket should restrict uploads to 4 MiB and the four MIME types as defence in depth; that is
  a staging configuration change and needs approval.
- The bucket name `v1` is generic. If the bucket later holds other documents, membership objects
  stay under their own key prefix, and the S3 keys still reach the whole project.
