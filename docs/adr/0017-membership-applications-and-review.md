# 0017 — Membership applications, SQU ID verification and review

Status: accepted for implementation (owner direction, 2026-10-20); **final approval policy
pending owner confirmation** (see "Open decisions"). The section "Where the ID card lives" is
superseded by [ADR 0018](0018-membership-id-cards-in-private-storage.md) (private Supabase
Storage); PostgreSQL storage remains the fallback until Storage is configured.
Related: UC-01 (`docs/UC-01_Deep_Dive.pdf`), ADR 0004, ADR 0012, ADR 0013, ADR 0015, ADR 0016,
`docs/UC-01_Membership_Applications.md` (the data and security contract)

## Context

UC-01 was deferred while UC-02 shipped. Its deep dive describes direct self-registration: a
five-field form, a duplicate check, a `members` row written immediately, a confirmation email
and a first login.

The owner has now directed membership registration to go through **verification and
administrative approval** instead:

- the applicant uploads an image or PDF of their Sultan Qaboos University student ID card;
- the application waits in the administrative dashboard;
- Society Affairs management and Senior Management review it;
- only an approved application becomes an active member account, provisioned through the
  existing Auth invitation flow, with no elevated access.

The public website (separate repository, ADR 0016) already contains the membership form design.
It collects full name, SQU email, student ID, academic year, discipline, up to four interests and
a consent tick.

## Decision

### Lifecycle

```text
submitted ─► pending_review ─► verified ─► approved ─► (activated: members row + Auth invitation)
                   │              │
                   └──────────────┴──► rejected
```

- `pending_review`: stored, awaiting review. No Auth identity is created and no access exists.
  Nothing an applicant submits can set a role, committee, status or reviewer.
- `verified`: a reviewer has checked the details against the ID card.
- `approved`: final approval under the confirmed approval policy. The ID document is deleted in
  the same transaction.
- `rejected`: final. The ID document is deleted in the same transaction. A new application is
  then allowed.
- **Activation** happens after approval. Core finds the Auth identity for the application's
  email, or sends the standard Supabase Auth **invitation** (the person chooses their own
  password; no password is ever generated, stored or emailed by the application). It then writes
  the `members` row (`status = member`) and links it to the application. Activation grants
  **no** `administrative_access`.
- **Who sends the invitation.** ADR 0013 kept every Auth Admin call behind Technical-only
  actions. This decision extends exactly one call, `inviteAuthUser`, from the existing Auth
  Admin module (`lib/auth/admin.ts`, ADR 0015 precondition 4 unchanged), to membership
  reviewers. The invitation goes only to the email stored on an application the database
  reports as approved and not yet activated, read from the database, never from the request.
  Then `private.activate_membership` re-checks the reviewer, the state and that exactly one Auth
  identity has that email before writing the member. A failed invitation (rate limit, SMTP)
  leaves the application approved with activation pending, retried from the dashboard.

### Who may review

Reviewer authority is computed in the database from live `administrative_access`, at call time:

| Access                                                           | Membership authority                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `COMMITTEE_MANAGER` of the committee with slug `society-affairs` | Society Affairs reviewer                                                      |
| `BOARD_ADMIN`                                                    | Senior Management reviewer                                                    |
| `TECHNICAL`                                                      | Senior Management reviewer (ADR 0012: Technical holds full application scope) |
| Any other manager, or no active access                           | None. Every routine refuses; the dashboard shows nothing                      |

The committee is identified by its stable slug, never by its display name. Organisational
positions (committee heads, team leaders) confer nothing. Only an explicit grant through
`/admin/access` does. A reviewer can never review an application whose email is their own
Auth email.

"Senior Management" (الإدارة العليا) is represented by the existing `BOARD_ADMIN` level. No new
access level, role table or permission engine is introduced.

### Approval policy: implemented, not chosen

Core had no policy for membership approval, and the organisational chart is not an
authorization policy. Both candidate policies are implemented and tested. The active one is a
single database setting, `NULL` until the owner confirms:

| Setting          | Final approval                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `NULL` (default) | **Approval and activation are refused** (`POLICY_NOT_CONFIRMED`). Review, verification and rejection work.     |
| `two_step`       | A Society Affairs or Senior Management reviewer verifies; a **different** Senior Management reviewer approves. |
| `single_step`    | Any reviewer (Society Affairs or Senior Management) may approve a pending or verified application.             |

Only a Technical user can record the setting, through an audited routine, after the owner's
decision.

### Where the ID card lives

The document is stored in Core's own PostgreSQL, in `private.membership_documents` (forced RLS,
no grants to any login or browser role, reachable only through fixed routines), not in a
Supabase Storage bucket. Reasons:

- Storage access from the server would need the service-role key. ADR 0015 (precondition 4)
  confines that key to the Auth Admin module. Storage RLS policies for browser roles would expose
  a public write surface.
- The application row and its document are written in **one transaction**: there are no orphaned
  uploads or abandoned objects to sweep.
- There is no storage path, public URL or signed URL to leak. A reviewer's view is an
  authenticated dashboard request that re-checks authority and writes an audit row.
- Deletion is part of the decision transaction and is testable on plain PostgreSQL.

Cost, accepted deliberately: document bytes count against the database size (the Supabase Free
plan allows 500 MB). Mitigations: a 4 MiB limit (inside Vercel's 4.5 MB request limit), images
re-encoded and downscaled in the browser before upload, and deletion at the final decision, so
only undecided applications hold documents.

### Data minimisation and retention

- Stored: the form fields, consent version and time, the document (until decided), review state,
  reviewer IDs and times, an optional internal note (≤ 500 characters).
- Not stored: the client IP on the application (rate-limit attempts are kept in a separate table
  for 24 hours), EXIF data (re-encoded away in the browser for images), any password.
- Audit rows identify the application by ID only: never the name, email, student ID or document.
- The applicant checks status with a 256-bit capability token, returned once at submission and
  stored only as a SHA-256 hash.

### Public API (additive within v1)

- `POST /v1/membership-applications` (`multipart/form-data`): public, no key or cookie,
  exact-origin CORS, per-IP rate limit, server-side validation of every field and of the file's
  signature.
- `POST /v1/membership-applications/status`: the applicant's own status by token.

No list, review or document endpoint exists on the public API. Review is dashboard-only behind
Supabase Auth, per ADR 0015.

## Open decisions (owner)

1. **Final approval policy:** `two_step` or `single_step`. Until set, nothing can be approved.
2. **UC-01 open questions, answered here from the approved website form; confirm:** email must be
   an SQU address (`…squ.edu.om`); student ID is 6–10 digits; academic year (1–5) and discipline
   are required; interests are optional (up to four).
3. **Retention for undecided applications.** Decided applications lose their document at the
   decision. Proposed: an undecided application older than 180 days is rejected with reason
   "expired" by a Technical action; not automated yet.
4. **University privacy approval** of the consent wording and of keeping ID-card images for the
   review period.
5. **Technical as reviewer.** Implemented because ADR 0012 gives Technical full application
   scope. Confirm, or restrict it to emergency use.

## Consequences

- UC-01's direct-creation flow is superseded by application, review and invitation. The deep
  dive's duplicate rules still hold: an email or student ID that matches an existing member, or an
  open application, is the same person, not a new one.
- `members` receives rows only through `private.activate_membership`.
- Linking a member's earlier event registrations by email (ADR 0004) remains future work and is
  not built speculatively.
- Notifications use existing infrastructure only: the on-screen confirmation at submission, the
  Supabase invitation at activation, and the status check. Application-originated email (received
  and rejected notices) needs `RESEND_API_KEY` and is a follow-up.
