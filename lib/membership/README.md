# membership

UC-01 membership applications, as decided in `docs/adr/0017-membership-applications-and-review.md`.
Where ID cards are stored: `docs/adr/0018-membership-id-cards-in-private-storage.md`. The data and
security contract is `docs/UC-01_Membership_Applications.md`. Development Cycle 2
(`docs/adr/0025-expanded-membership-verification-and-leadership.md`, migration `0033`) adds
membership categories and institutions and removes the registration ID card. SQU student
verification and leadership live in `lib/verification/`.

Every read and write goes through the fixed `private.*` routines of migrations `0025`, `0026`,
`0033` and `0037` over the restricted `app_runtime` connection. Under the `automatic` approval
policy (`docs/adr/0029-automatic-membership-approval.md`, migration `0037`) the submission routine
approves a valid application itself; the member record still waits for the applicant's confirmed
sign-in. Those routines own:

- validation and duplicate checks;
- the per-IP limit;
- reviewer authority and the approval policy;
- state transitions, document deletion and the Storage deletion queue;
- `members` writes and audit.

This module validates transport shapes, keeps the S3 client and document checks that
`lib/verification` reuses, reads legacy ID cards for reviewers, and maps the routines' result
codes. It never decides who may do what.

- `index.ts`: public, anonymous side.
  - `membershipOptions()` returns the categories, institutions and consent version from
    `private.get_membership_options` (cached five minutes).
  - `validateApplication(raw, options)` reports field errors by category and drops any field the
    category does not collect.
  - `submitMembershipApplication(input, ip)` creates the 256-bit status token, stores only its
    SHA-256, and calls `private.submit_membership_application_v2`. No file is uploaded. It returns
    the stored `status` (`approved` under the `automatic` policy, otherwise `pending_review`)
    and the `accountActivation` recorded with it (ADR 0030).
  - `setUpImmediateAccount(token)` (ADR 0030): for an application submitted under immediate
    activation, creates the account the database reserved through `lib/auth/admin.ts`, links it,
    and returns a one-time sign-in token hash. Used by `app/v1/membership-applications/account`.
  - `getApplicationStatus(token)` returns the applicant's view.

  Used by `app/v1/membership-applications/**`.

- `storage.ts` (server-only): the only user of the S3 keys (`SUPABASE_S3_*`). It holds the
  configuration rules (all five variables or none), random object keys under a prefix
  (`membership-id-cards/` or `squ-verification/`), SigV4 signing, and single-object upload, read
  and delete. It logs only the operation and HTTP status.
- `document.ts`: `checkDocument(bytes)` recognises JPEG, PNG, WebP and PDF by signature, applies
  the 4 MiB limit and refuses PDFs with active content.
- `server.ts` (server-only): dashboard reads and actions for the actor ID from
  `getManagerContext()`. The ID always comes from the verified session, never from a form.
  - `getMembershipAccess` tells reviewer, not-a-reviewer and unavailable (setup) apart.
  - `readMembershipDocument` fetches a Storage object and checks it against the recorded size and
    SHA-256.
  - `processMembershipStorageDeletions` empties the deletion queue.
- `access.ts`: which roles the membership rules name. Used only to decide who is told that review
  needs setup when the database cannot answer; it grants nothing.
- `labels.ts`: display labels and the safe messages for each result code.
- `cursor.ts`: opaque list cursors bound to the filter and search they came from.
- `db.ts`, `types.ts`: implementation details and shared vocabularies.

The discipline, interest and consent-version lists in `types.ts` (`CONSENT_VERSIONS`: the current
`2026-11-v2` and the previous `2026-10-v1`) mirror the website's form and the database routines. Change all three together. `tests/db/membership.test.ts` fails if Core and
the database disagree.

Invitations are not sent from here. The activation server action calls `inviteAuthUser` from
`lib/auth/admin.ts`, the only module holding the service-role key, with the email the database
stores for an approved application.
