# ADR 0025: Expanded membership, SQU student verification and committee leadership

Accepted for local implementation by the owner's November 17, 2026 request, "Development Cycle 2 —
Expanded Membership, Profile Verification, and Committee Leadership". Migration
`0033_membership_verification_leadership` is forward-only and unapplied to hosted environments;
applying it needs the owner's approval.

**Amended by [ADR 0027](0027-configurable-committee-and-team-permissions.md) on 2026-11-22:**
an approved appointment gives the dashboard permissions assigned to its committee or team; the
statements below that appointments never grant dashboard access no longer apply. SQU and
leadership review authority, and the settings, are permissions (initially Board Administration
and, through its committee's configuration, Society Affairs; Technical keeps the settings).

**Amended by [ADR 0026](0026-committee-level-leadership-and-request-switch.md) on 2026-11-20:**
leadership belongs to a committee, and to a team only for team leadership; members can request
committee-level positions in any committee; a switch opens or closes new requests.

**Amended on 2026-11-19** by the owner's review of the open policies (see "Policy review" below):
review authority, appointments across teams, and what counts towards the request limits. 0033 was
still unapplied anywhere hosted, so the migration itself carries the change.

This ADR amends ADR 0017 (membership is no longer limited to SQU students, and registration no
longer collects an ID card), ADR 0018 (the private ID-card bucket also holds SQU verification
evidence, under its own key prefix) and ADR 0024 (committees gain teams and leadership
appointments). Everything else in those ADRs stands. The working summary for both repositories is
[`docs/development-cycle-2.md`](../development-cycle-2.md).

## Five separate concepts

Nothing in this ADR lets one of these imply another:

| Concept                    | Where it lives                                                   | Granted by                                                           |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Account (authentication)   | Supabase Auth                                                    | Sign-up and email confirmation                                       |
| Membership                 | `membership_applications` → `members`                            | Membership review and activation (ADR 0017)                          |
| SQU student verification   | `private.squ_verification_requests`, `private.squ_verifications` | Board Administration or Society Affairs, after checking the evidence |
| Organizational appointment | `private.leadership_requests`, `private.leadership_appointments` | Board Administration or Society Affairs (leadership reviewers)       |
| Administrative (dashboard) | `public.administrative_access`                                   | `/admin/access` only (ADRs 0012–0014, 0024)                          |

Approving membership does not verify anyone as an SQU student. Verification does not make anyone a
member or change membership. A Chief or Assistant Chief appointment writes nothing to
`administrative_access`, and no routine in this ADR reads an appointment to decide authority.

## Membership categories and institutions

- **Categories** are rows in `private.membership_categories` with a stable `id`, English and
  Arabic labels, an `institution_mode` (`required`, `optional`, `none`) and whether the academic
  year is required. The initial rows:

  | id                      | Institution                 | Academic year |
  | ----------------------- | --------------------------- | ------------- |
  | `university_student`    | required (their university) | required, 1–5 |
  | `graduate`              | optional (alma mater)       | not collected |
  | `academic`              | not collected               | not collected |
  | `industry_professional` | not collected               | not collected |
  | `other`                 | not collected               | not collected |

- **Institutions** are rows in `private.institutions` (stable slug, English and Arabic names,
  country, order, active flag), seeded with Omani universities: SQU, UTAS, University of Nizwa,
  GUtech, Sohar University, Dhofar University, A'Sharqiyah University, University of Buraimi,
  National University of Science and Technology, Middle East College and Muscat University.
  "Other university" is not a row: the applicant types the name (2–120 characters), which covers
  international institutions. A record holds a listed institution **or** a typed name, never
  both.
- The routines read the category row to decide which fields apply. A field that does not apply is
  refused by the database and dropped by Core before it is sent, so a value typed before the
  applicant changed category is never stored.

## Registration (amends ADR 0017)

- Any valid email address is accepted, personal or institutional.
- The student ID is no longer collected at registration, for any category. Student numbers repeat
  across universities, so a global unique student ID cannot identify people once other
  universities are admitted; the SQU student number is collected by the separate verification
  flow instead. Existing student IDs stay on existing records.
- **No ID card is uploaded at registration.** Core no longer reads or stores a document from the
  membership form. The review, approval policy, invitation and activation of ADR 0017 are
  unchanged; "verify" now means a reviewer has checked the submitted details.
- New consent wording `2026-11-v2` (in the website, not mentioning an ID card). The previous
  version `2026-10-v1` remains accepted from the previous website build during a release.
- Duplicate rules: an email that belongs to a member or an open application is the same person.
  The limit of five submissions per client IP address an hour is unchanged.
- **Release compatibility.** For one release Core also accepts the previous website's form: it is
  treated as a University Student at SQU, and its student ID and ID card are discarded, never
  stored. The 0025/0026 submission routines remain in the database so the previous Core keeps
  working until the new one is deployed.

### Legacy records

Every existing application and member was admitted through the SQU-only form. Migration 0033
therefore backfills, for rows whose email is an `squ.edu.om` address only:

- applications: category `university_student`, institution `squ`;
- members: category `graduate` when `status = 'graduate'`, otherwise `university_student`;
  institution `squ`.

Any other row keeps an unrecorded category (`NULL`), which the member can complete on their
profile. **No legacy member is marked SQU-verified**: an ID card checked under the old flow was
deleted at the decision and is not evidence for the new verification.

## SQU student verification

- A signed-in **member** submits an SQU student number (6–10 digits) and one image or PDF of their
  SQU student ID card. The file is checked by content (JPEG, PNG, WebP or PDF, at most 4 MiB, no
  active PDF content), stored privately, and referenced by size and SHA-256.
- States shown to the member: not verified, pending review, verified, rejected (with the
  reviewer's member-facing reason), revoked (with its reason).
- **Reviewers** are Board Administration and the Society Affairs committee manager
  (`private.verification_reviewer_kind`). Technical access alone grants no review authority: a
  Technical user sees the settings, not the evidence. Nobody decides or revokes their own
  verification.
- Approval writes a `squ_verifications` row with the reviewer and time, in the same transaction
  as the request's decision. A student number can be verified for only one member at a time, and
  a member has at most one active verification and one pending request.
- **Revocation** keeps the verification row and marks it revoked, with a member-facing reason and
  an optional internal note. The member may then submit again.
- **Resubmission** after a rejection or revocation is allowed, limited to
  `squ_submissions_per_30_days` submissions in any 30 days (default 3), so a member can correct
  rejected evidence twice in a month. Only a stored submission counts: a refused or failed upload
  writes no request. Pending requests cannot be duplicated or replaced; the member waits for the
  decision.
- Reviewer notes are internal. Member responses never contain a reviewer note, a reviewer's
  identity, a document key or the full student number (it is masked to the last three digits).

### Evidence storage and retention

- Objects go to the existing private membership bucket (`SUPABASE_S3_MEMBERSHIP_BUCKET`) under the
  prefix `squ-verification/<uuid v4>.<ext>`, using ADR 0018's begin → upload → submit order.
  Without Storage configured, Core keeps the bytes in PostgreSQL, as ADR 0018 allows for ID cards.
  No public or signed URL exists: reviewers read a document through an authenticated dashboard
  route that re-checks their authority, audits the view and verifies size and SHA-256.
- Unlike membership ID cards, verification evidence is **not** deleted at the decision, because a
  verification can be revoked and re-examined later. No retention period has been decided, so the
  setting `document_retention_days` is `NULL` and the cleanup routine does nothing. When the owner
  sets a period (30–3,650 days), documents of decided requests older than that are deleted in
  small batches when reviewers open the verification list, each deletion queued for Storage in the
  same transaction. Pending requests are never purged, and existing documents are never deleted
  by this migration.

## Teams, positions and appointments (amends ADR 0024)

- The hierarchy is Engineering Society → Committee → Team → Assignment. Teams belong to exactly
  one committee, have an English name (required) and an Arabic name (optional, the English name is
  shown when missing), optional descriptions in both languages, and a status: `active`,
  `inactive` or `archived`.
- **Positions** are rows in `private.organizational_positions`. The initial rows are `chief` and
  `assistant_chief`, both requestable. Each position has a `max_holders_per_team`, so a future
  non-requestable `member` position needs only a row.
- **Who manages teams:** Board Administration and Technical (the senior administrators of ADR
  0024), from the committee page. Teams referenced by a request or appointment cannot be deleted;
  they are deactivated or archived. Unused teams can be deleted.
- **Structure changes:**

  | Change                       | Pending requests                      | Active appointments                    |
  | ---------------------------- | ------------------------------------- | -------------------------------------- |
  | Move to another committee    | Closed as cancelled (`team_moved`)    | Kept; they now read under the new path |
  | Deactivate                   | Closed as cancelled (`team_inactive`) | Kept                                   |
  | Archive                      | Closed as cancelled (`team_archived`) | Refused while any exist                |
  | Archive the parent committee | Closed (`committee_archived`)         | Refused while any exist                |

  Moving a team changes no `administrative_access` row. Cancelled requests stay in the history,
  and the member may request again.

- **Requests.** A member chooses an active committee, an active team in it and a requestable
  position. The database re-checks the hierarchy. One pending request per member and team; at most
  `leadership_requests_per_30_days` (default 5) in 30 days, not counting requests the structure
  cancelled (team moved, deactivated or archived), which are not the member's attempts.
- **Leadership reviewers** are Board Administration and the Society Affairs committee manager
  (`private.leadership_reviewer_kind` delegates to `verification_reviewer_kind`). They approve and
  reject requests, revoke appointments, and assign or change appointments directly (Board does so
  from the committee page). Technical manages teams but has no appointment authority by its access
  alone. Self-approval, self-appointment and self-revocation are refused.
- **Occupancy.** Approval, direct assignment and position changes take one exclusive lock for the
  organization structure, so concurrent decisions serialize and a position never exceeds its
  limit. Each team has one active Chief and one active Assistant Chief by default
  (`max_holders_per_team` = 1). A member may hold positions in several teams but only one position
  per team (a unique index). `max_active_appointments_per_member` is `NULL` (no cross-team cap) by
  default; Technical can set one. These values are recorded in settings and changed only by
  Technical, through audited routines.

## Settings and audit

- `private.verification_settings` (one row) holds the limits above and the retention period.
  Technical changes them through an audited routine; position limits likewise.
- Every submission, decision, view of evidence, revocation, appointment change, team change and
  settings change writes an append-only audit row identifying the member by `memberId` only, so
  account erasure (ADR 0024) pseudonymizes it.

## Notifications

Core has no application-originated email (ADR 0017; `RESEND_API_KEY` is reserved and unused).
Decisions therefore notify the member **in their profile**: the status, the decision date and the
member-facing reason appear on the next visit. No notification provider is added. Email or
in-site notices are follow-up work.

## Policy review (owner, 2026-11-19)

Decided and implemented:

- **Positions:** one active Chief and one active Assistant Chief per team; appointments across
  different teams allowed; never both positions in one team; duplicates and concurrent approvals
  serialized by the organization lock and unique indexes.
- **Reviewers:** Board Administration and Society Affairs review SQU evidence and decide
  leadership; Technical access alone grants no review authority.
- **Resubmissions:** corrections allowed within the limits above; one pending request at a time;
  failed or refused uploads and structure-cancelled leadership requests do not count.
- **Notifications:** decisions always appear in the profile, the existing supported channel.

## Open decisions (owner)

1. **Retention** of SQU verification evidence after a decision. Recommended: 365 days after the
   decision, set by Technical in the settings once approved. Until then it is `NULL` and nothing is
   deleted.
2. **Technical as an application reviewer** (ADR 0017 open decision 5). SQU and leadership review
   no longer include Technical; membership applications still do.
3. **Notification email** for decisions. It needs a transactional email provider configured for
   Core (none is used today; `RESEND_API_KEY` is reserved and unread), a verified sending domain
   and approved wording.
4. **University privacy approval** of collecting SQU student numbers and ID images for
   verification (ADR 0017's open decision 4 carries over).

## Consequences

- `members.university_id` and `membership_applications.university_id` and `academic_year` become
  nullable. Existing values are kept.
- Member deletion and account erasure (ADR 0024) also remove a person's verification requests,
  verifications, evidence, leadership requests and appointments; decisions they made about other
  people are accountability records that block erasure, like other decisions.
- The dashboard's membership section gains SQU verification and leadership tabs; the committee page
  gains teams and appointments.
