# UC-01 membership applications: data and security contract

Status: implemented on branch `feat/uc01-membership-applications` (October 20, 2026, Dubai).
**Not deployed.** Migration `0025_membership_applications` has been applied only to disposable
local databases. Final approval and activation stay disabled until the owner confirms the approval
policy (ADR 0017, "Open decisions").

Decision record: [ADR 0017](adr/0017-membership-applications-and-review.md). Access model:
[ACCESS_CONTROL.md](ACCESS_CONTROL.md). Public API: [openapi.v1.yaml](api/openapi.v1.yaml) and
[LANDING_HANDOFF_V1.md](api/LANDING_HANDOFF_V1.md).

## 1. State machine

| From                           | Action   | To                                       | Who                                                                                           | Notes                                                                      |
| ------------------------------ | -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| (none)                         | submit   | `pending_review`                         | Anyone, through `POST /v1/membership-applications`                                            | Application and ID document are written in one transaction                 |
| `pending_review`               | verify   | `verified`                               | Any reviewer                                                                                  | Records `verified_by`/`verified_at`                                        |
| `pending_review`               | approve  | `approved`                               | `single_step` only: any reviewer                                                              | Deletes the document in the same transaction                               |
| `verified`                     | approve  | `approved`                               | `two_step`: a Senior Management reviewer other than the verifier; `single_step`: any reviewer | Deletes the document in the same transaction                               |
| `pending_review` or `verified` | reject   | `rejected`                               | Any reviewer                                                                                  | Final. Deletes the document. A new application is then allowed             |
| `approved` (not activated)     | activate | `approved` + `activated_at`, `member_id` | Any reviewer, policy confirmed                                                                | Writes the `members` row; invitation first if the Auth identity is missing |

Every routine re-reads the reviewer's live access, locks the application row, checks the
expected `revision` (a stale page gets `STALE_REVISION`), refuses the reviewer's own application
(`SELF_REVIEW`, by Auth email) and writes exactly one audit row with the change.

While `membership_settings.approval_policy` is `NULL`, `approve` and `activate` return
`POLICY_NOT_CONFIRMED`. Submission, listing, viewing, verification and rejection work.

The applicant sees three states only: `pending_review` (which includes `verified`), `approved`
and `rejected`, plus whether the account is activated.

## 2. Application data

Stored in `private.membership_applications` (forced RLS, owner-only policy, no grants to any
login or browser role). Each rule is enforced twice: by the route and the database routine, and
again by a table CHECK constraint.

| Field               | Rule                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `full_name`         | Trimmed, 1–200 characters, no control characters (the website also asks for first and last name)             |
| `email`             | Lowercased; must end in `squ.edu.om` (including subdomains); one address                                     |
| `university_id`     | 6–10 digits                                                                                                  |
| `academic_year`     | 1–5                                                                                                          |
| `discipline`        | One of the website's seven ids: mechanical, electrical, civil, petroleum, chemical, mechatronics, industrial |
| `interests`         | Optional; at most four distinct ids from the website's fourteen (`lib/membership/types.ts`)                  |
| `consent_version`   | `2026-10-v1` (the wording in section 8); `consent_accepted_at` is set by the database                        |
| `status_token_hash` | SHA-256 of the applicant's 256-bit status token; the token itself is never stored                            |
| review columns      | `status`, `verified_by/at`, `decided_by/at`, `decision_note` (≤ 500 characters, internal)                    |
| activation          | `member_id`, `activated_at`                                                                                  |

Duplicates: an email or student ID that already belongs to a `members` row is `409
already-member`. One already used by a `pending_review`, `verified` or `approved` application is
`409 already-applied` (partial unique indexes back the check under concurrency). A rejected
application does not block a new one.

Not stored on the application: the client IP, the original file name, EXIF or other metadata,
any password.

## 3. The ID card document

| Aspect    | Contract                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Types     | JPEG, PNG, WebP or PDF, established from the file's leading bytes, never from its name or declared type                              |
| PDFs      | Refused if they contain active content: `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction`, `/AA`, `/RichMedia`, `/XFA` |
| Size      | 1 byte to 4 MiB; the whole request is capped at 4.5 MB before parsing                                                                |
| Integrity | The routine recomputes SHA-256 over the bytes and refuses a mismatch                                                                 |
| Browser   | The website re-encodes photos to JPEG (longest side ≤ 2000 px, white background), which drops metadata; PDFs are sent unchanged      |
| Storage   | `private.membership_documents`, one row per application, `bytea`, `ON DELETE CASCADE`                                                |
| Viewing   | `GET /admin/membership/{id}/document`, signed-in reviewers only, re-checked per request; audited as `membership.document_viewed`     |
| Headers   | Stored type, `inline; filename="squ-id-card.<ext>"`, `private, no-store`, `nosniff`, `no-referrer`, CSP `default-src 'none'`         |
| Deletion  | In the same transaction as approval or rejection; `document_deleted_at` records it                                                   |

There is no Supabase Storage bucket, public URL or signed URL. See ADR 0017 for the reasons.

## 4. Roles and permissions

Reviewer authority is computed from live `public.administrative_access` on every call.

| Action                                   | Society Affairs manager | Other committee manager | Board (Senior Management) | Technical             | Signed in, no access | Applicant |
| ---------------------------------------- | ----------------------- | ----------------------- | ------------------------- | --------------------- | -------------------- | --------- |
| Submit an application                    | –                       | –                       | –                         | –                     | –                    | Yes       |
| Check own status (token)                 | –                       | –                       | –                         | –                     | –                    | Yes       |
| See Membership in the dashboard          | Yes                     | No                      | Yes                       | Yes                   | No                   | No        |
| List, open, view ID card                 | Yes                     | No                      | Yes                       | Yes                   | No                   | No        |
| Verify                                   | Yes                     | No                      | Yes                       | Yes                   | No                   | No        |
| Reject                                   | Yes                     | No                      | Yes                       | Yes                   | No                   | No        |
| Approve, `two_step` (after verification) | No                      | No                      | Yes, not the verifier     | Yes, not the verifier | No                   | No        |
| Approve, `single_step`                   | Yes                     | No                      | Yes                       | Yes                   | No                   | No        |
| Activate an approved application         | Yes                     | No                      | Yes                       | Yes                   | No                   | No        |
| Record the approval policy               | No                      | No                      | No                        | Yes                   | No                   | No        |
| Review own application                   | No                      | –                       | No                        | No                    | –                    | –         |

The Society Affairs manager is the `COMMITTEE_MANAGER` of the committee whose slug is
`society-affairs`. Organisational titles in the society's chart confer nothing; only a grant
through `/admin/access` does. Technical as a reviewer is open decision 5 in ADR 0017.

## 5. Public API

Both endpoints are public, take no key or cookie, use exact-origin CORS
(`CORE_API_ALLOWED_ORIGINS`) and answer `no-store`.

- `POST /v1/membership-applications`, `multipart/form-data`, fields `fullName`, `email`,
  `universityId`, `academicYear`, `discipline`, `interests` (repeated), `consent` (`true`),
  `consentVersion`, `idDocument` (the file). Any other field is `422 unexpected-field`.
  - `201 {data:{status:"pending_review", statusToken}}`. The token is shown once.
  - `409` with `reason` `already-applied` or `already-member`.
  - `413` above 4.5 MB, `422 invalid-fields` with `errors[]`.
  - `429` with `Retry-After: 3600` from the sixth attempt in an hour from one IP. Attempts are
    kept in `private.membership_submission_attempts` and purged after a day.
  - `503` for anything unexpected.
- `POST /v1/membership-applications/status`, JSON `{statusToken}` (never in a URL):
  `200 {data:{status, submittedAt, decidedAt, activated}}`, `404` for an unknown token.

The client IP comes only from `x-vercel-forwarded-for` in production, as for event registration.

## 6. Dashboard

`/admin/membership`, titled "Membership applications" (طلبات العضوية; the dashboard is in English
like the rest of the admin), lists applications oldest first,
with status filters, a literal substring search on name, email or student ID, and 25-row cursor
pagination. The sidebar badge
shows the number awaiting action. `/admin/membership/{id}` shows the fields, the ID card (click
to reveal), the review history and the actions allowed for the viewer. A banner explains when
the policy is unset, and Technical users see the policy form.

Activation (`app/admin/(protected)/membership/actions.ts`) asks the database first. If no Auth
identity has the application's email, it sends the standard Supabase invitation to the email read
from the database, never from the request, and then records the member. An existing identity
receives no new email. A rate-limited or failed invitation leaves the application approved, and
the dashboard offers a retry.

## 7. Audit

`private.uc02_audit` actions: `membership.submitted`, `membership.verified`,
`membership.approved`, `membership.rejected`, `membership.activated`,
`membership.document_viewed`, `membership.policy_changed`. Rows carry the actor and the
`applicationId`, plus, where relevant, the previous and next status, the reviewer kind, the
policy, whether the document was deleted, whether a note exists, and the invitation outcome. They
never carry the name, email, student ID, note text or document. Submission rows are anonymous.

## 8. Consent wording, version `2026-10-v1`

Shown next to the checkbox on the website; the version is sent with the application.

> I confirm that these details are mine and accurate, and I agree that the Engineering Society may
> use them and my SQU ID card to review my membership application.

> أؤكد أن هذه البيانات تخصني وأنها صحيحة، وأوافق على أن تستخدمها الجماعة الهندسية مع بطاقتي
> الجامعية لمراجعة طلب عضويتي.

The ID card hint adds: it is used only to confirm SQU enrolment, seen only by the society's
reviewers, and deleted as soon as the application is decided. A wording change needs a new
version in `CONSENT_VERSIONS`, the database routine and the website.

## 9. Notifications

- On submission: the on-screen confirmation and the status token, stored in that browser.
- On activation: the Supabase Auth invitation, so the applicant chooses their own password.
- At any time: the website's status view.

Nothing else is sent. No email contains the ID card, the note, reviewer identities or a
password. Application-originated email (received and rejected notices) needs
`RESEND_API_KEY` and an owner decision; it is not built.

## 10. Retention

Decided applications keep no document. Undecided applications keep theirs until a decision.
The proposal is that applications undecided after 180 days are rejected as expired by a Technical
action; it is not automated (ADR 0017, open decision 3). Application rows and audit rows are
permanent records, like other UC-02 audit.

## 11. Verification evidence (local only)

- `tests/db/membership.test.ts`: 22 tests on real PostgreSQL 17 with the production role model.
  They cover every transition and refusal, the Society Affairs/other-manager split, revocation
  taking effect at once, self-review by email, both policies, document deletion, `members`
  writes, grants and RLS, and audit contents.
- Route, action, document-route, domain and navigation unit tests; the full Core suite passed:
  48 files, 478 tests, 1 skipped.
- Playwright (`tests/e2e/admin-auth.spec.ts`): the membership pages and the document route are
  behind the sign-in boundary on desktop and mobile. 45 passed, 1 skipped.
- Cross-project browser run: website production build against a Core production build on a
  disposable database, synthetic identities and files only. It covered validation, client-side
  type refusal, JPEG re-encoding without metadata, PDF byte-for-byte, active-PDF refusal, both
  duplicate reasons, 429, the review lifecycle, website status views, Arabic and phone layouts,
  and unchanged event registration.

Not verified: signed-in dashboard pages against real Supabase Auth, and a real invitation email.

## 12. Deployment actions (each needs the owner's approval)

1. Review and merge `feat/uc01-membership-applications`.
2. Apply `0025_membership_applications.sql` to **staging**, using the same MCP or CLI method and
   the read-only postflight used for 0024: forced RLS on the four new tables, zero `app_runtime`
   table grants, execution only on the listed routines, and existing registrations unchanged.
3. On staging: run the live API checks, one synthetic application, and the dashboard as a pilot
   Society Affairs manager, Board user and Technical user. Delete the synthetic data afterwards.
4. Apply 0025 to **production** only after staging passes and with explicit approval. 0025 is
   additive: new tables, new routines, a wider audit CHECK, and select/insert on `members` for
   the routine owner.
5. Record the approval policy only after the owner's decision. A Technical user does this from
   `/admin/membership`.
6. Supabase Auth: confirm the invite template wording suits new members, not only
   administrators. The configured custom SMTP allows 30 Auth emails an hour, which limits
   activations per hour. No storage bucket is needed.
7. Grant a Society Affairs manager through `/admin/access` when the owner names one. Nothing
   in the organisational chart is imported.
