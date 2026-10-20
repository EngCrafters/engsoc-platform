# membership

UC-01 membership applications, as decided in `docs/adr/0017-membership-applications-and-review.md`.
The data and security contract is `docs/UC-01_Membership_Applications.md`.

Every read and write goes through the fixed `private.*` routines of migration `0025` over the
restricted `app_runtime` connection. Those routines own validation, duplicate checks, the per-IP
limit, reviewer authority, the approval policy, state transitions, document deletion, `members`
writes and audit. This module validates transport shapes and maps the routines' result codes. It
never decides who may do what.

- `index.ts`: public, anonymous side. `validateApplication(raw)` reports field errors.
  `submitMembershipApplication(input, ip)` creates the 256-bit status token and stores only its
  SHA-256. `getApplicationStatus(token)` returns the applicant's view. Used by
  `app/v1/membership-applications/**`.
- `document.ts`: `checkDocument(bytes)` recognises JPEG, PNG, WebP and PDF by signature, applies
  the 4 MiB limit and refuses PDFs with active content.
- `server.ts` (server-only): dashboard reads and actions for an authenticated actor ID from
  `requireAdminManager()`. The ID always comes from the verified session, never from a form.
- `labels.ts`: display labels and the safe messages for each result code.
- `cursor.ts`: opaque list cursors bound to the filter and search they came from.
- `db.ts`, `types.ts`: implementation details and shared vocabularies.

The discipline, interest and consent-version lists in `types.ts` mirror the website's form and
the database routine. Change all three together. `tests/db/membership.test.ts` fails if Core and
the database disagree.

Invitations are not sent from here. The activation server action calls `inviteAuthUser` from
`lib/auth/admin.ts`, the only module holding the service-role key, with the email the database
stores for an approved application.
