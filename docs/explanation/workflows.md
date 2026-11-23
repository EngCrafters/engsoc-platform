# Business workflows

Each workflow below lists:

- its entry points;
- the states it moves through;
- who may act;
- what it writes;
- how it fails;
- what it depends on outside Core.

Everything is **Source** unless labelled otherwise. The routines named are in `db/migrations/`
and listed in [Database security](../reference/database-security.md#routine-catalog). The website's
side of the same flows is in ESWebsite's
[workflows](https://github.com/EngCrafters/essqu-web/blob/main/docs/explanation/workflows.md).

## Membership: application to active member

```mermaid
sequenceDiagram
  participant V as Applicant (website)
  participant C as Core /v1
  participant DB as PostgreSQL
  participant A as Supabase Auth
  participant R as Reviewer (dashboard)
  V->>C: GET /membership-options (categories, institutions)
  V->>C: POST /membership-applications (category fields, no ID, no card)
  C->>DB: submit_membership_application_v2 (rate limit, duplicates) → approved or pending_review
  C-->>V: 201 status + statusToken
  V->>A: signUp(email, password) → confirmation email
  V->>A: confirm via email link
  alt automatic policy (ADR 0029, active since 0037)
    V->>C: GET /me/membership (confirmed sign-in)
    C->>DB: get_my_membership → members row + activated_at
  else single_step or two_step
    R->>DB: review_membership_application(verify)
    R->>DB: review_membership_application(approve|reject)
    R->>DB: activate_membership
    alt identity exists and is confirmed or invited
      DB->>DB: members row + activated_at
    else no identity
      R->>A: invite (Auth Admin API) → retry activation
    else identity unconfirmed
      V->>C: GET /me/membership after a confirmed sign-in → activation completes
    end
  end
```

**Automatic approval** (ADR 0029, migration 0037; the active policy). The submit routine stores a
valid application as `approved` with `auto_approved = true` and no reviewer, after the same
validation, address limit and duplicate checks. Nothing else changes: the member record is written
at the applicant's first confirmed sign-in (the website calls `GET /v1/me/membership` after the
confirmation link, and again whenever a member-only call answers `MEMBER_REQUIRED`), and a reviewer
can still send the invitation for an applicant who never finished sign-up. No reviewer step is
needed, and registration grants no administrative access, committee place or leadership.

**Account activation** (ADR 0030, migration 0038), a separate setting. Under
`email_confirmation` (the default) the website's Supabase sign-up sends the confirmation email, as
above. Under `immediate` the browser instead calls `POST /v1/membership-applications/account`
with its status token: Core creates the account it reserved with the Auth Admin API (confirmed,
no password, no email), links it, writes the member record if approved, and returns a one-time
sign-in token; the browser signs in and sets its password with Supabase Auth. An address that
already has an account is never signed in to. The application records that the address was not
verified. Without the service-role key the endpoint answers `not-configured` and the website
uses email confirmation.

| Step               | Entry point                                                                                                   | Who                                                                                                              | Writes                                                                                                                                                                        | Failure cases                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit             | `POST /v1/membership-applications`                                                                            | Anyone; any valid email                                                                                          | `membership_applications` (`pending_review`, token hash), `membership_documents` (bytes or Storage reference), `membership_submission_attempts`, audit `membership.submitted` | 422 validation; 409 `already-applied` or `already-member`; 429 after 20 per IP per hour; 503 when Storage is misconfigured or fails (nothing saved; an orphan upload is queued for deletion) |
| Account            | Website → Supabase `signUp`                                                                                   | Applicant                                                                                                        | `auth.users` (unconfirmed)                                                                                                                                                    | Sign-up failure keeps the application; the website offers a retry                                                                                                                            |
| Link               | `GET /v1/me/membership` (any confirmed sign-in)                                                               | Applicant                                                                                                        | `membership_applications.auth_user_id`, audit `membership.account_linked`                                                                                                     | Unconfirmed email links nothing (`emailConfirmed:false`)                                                                                                                                     |
| Verify             | Dashboard `reviewMembershipAction` (`verify`)                                                                 | Society Affairs manager, Board, Technical; not their own email                                                   | `status = verified`, `verified_by`, `revision + 1`, audit                                                                                                                     | `STALE_REVISION`, `INVALID_TRANSITION`, `SELF_REVIEW`, `FORBIDDEN`                                                                                                                           |
| Approve or reject  | Dashboard `reviewMembershipAction`                                                                            | Per policy: `single_step` any reviewer; `two_step` a Senior reviewer other than the verifier, after verification | Decision fields, note (≤ 500 characters), ID card row deleted (Storage object queued), audit                                                                                  | `POLICY_NOT_CONFIRMED` while the policy is unset; `VERIFICATION_REQUIRED`, `SENIOR_APPROVAL_REQUIRED`, `SECOND_REVIEWER_REQUIRED`                                                            |
| Activate           | Dashboard `activateMembershipAction`; or automatically at the applicant's next confirmed `GET /me/membership` | Reviewers; or the applicant's own confirmed sign-in                                                              | `public.members` row (id = Auth user ID), `activated_at`, `member_id`, audit `membership.activated`                                                                           | `NEEDS_INVITATION` (the action invites through the Admin API, then retries); `EMAIL_UNCONFIRMED` (waits); `CONFLICT` (two identities with the email, or a member with the same email or ID)  |
| Policy             | `setMembershipPolicyAction`                                                                                   | Technical                                                                                                        | `membership_settings.approval_policy`, audit `membership.policy_changed`                                                                                                      | `FORBIDDEN`                                                                                                                                                                                  |
| Correct name or ID | `POST /v1/me/profile/changes`, then dashboard `decideCorrectionAction`                                        | Member; then a membership reviewer                                                                               | `member_change_requests`; on approval the member row is updated; audit `member.change_requested` and `member.change_decided`                                                  | `ALREADY_PENDING`, `UNCHANGED`, `VALIDATION_ERROR`                                                                                                                                           |

**External dependencies:**

- Supabase Auth for sign-up, confirmation and invitations. Invitations need
  `SUPABASE_SERVICE_ROLE_KEY` and a redirect on the allow-list.
- No Storage: since migration 0033 (ADR 0025) the application carries no file. Applications from
  before 0033 may still hold an ID card, deleted at the decision.
- The website, for the applicant UI.

**Not implemented:**

- automatic expiry or deletion of applications;
- membership suspension.

## SQU student verification (0033)

| Step   | Entry point                                                          | Who                                                         | Writes                                                                                                | Fails with                                                                         |
| ------ | -------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Submit | `POST /v1/me/verification/squ` (website profile)                     | A member, for themself                                      | Evidence object (`squ-verification/`), request and document rows, audit `verification.submitted`      | `ALREADY_PENDING`, `ALREADY_VERIFIED`, `RATE_LIMITED`, invalid number or file, 503 |
| View   | `/admin/membership/verifications/[id]/document`                      | Board Administration, Society Affairs                       | Audit `verification.document_viewed`                                                                  | 404, size or SHA-256 mismatch                                                      |
| Decide | Dashboard `decideSquAction` → `decide_squ_verification`              | Board Administration, Society Affairs; not about themselves | Request decision; on approval a `squ_verifications` row; audit `verification.approved` or `.rejected` | `SELF_REVIEW`, `STALE_REVISION`, `STUDENT_NUMBER_IN_USE`, `INVALID_TRANSITION`     |
| Revoke | Dashboard `revokeSquAction` → `revoke_squ_verification`              | Board Administration, Society Affairs; not about themselves | `revoked_at`, reason, optional note; audit `verification.revoked`                                     | `SELF_REVIEW`, `INVALID_TRANSITION`                                                |
| Retain | `purge_expired_verification_documents` on the verification list view | Automatic, **only** once Technical sets a retention period  | Deletes evidence of decided requests older than the period, 25 at a time, queueing Storage objects    | Nothing happens while the period is `NULL` (the default)                           |

The member sees the state, the decision date and any member-facing reason on `/profile`. No email
is sent (ADR 0025, open decision 5).

## Committee and team leadership (0033, 0034)

A request or appointment belongs to a committee, and to a team only for team leadership (ADR 0026):
"Society Affairs Committee → Assistant Chief" is committee leadership, "Support & Logistics
Committee → Technical Team → Chief" team leadership. Every committee offers committee leadership,
with or without teams.

| Step               | Entry point                                                                                         | Who                                                                                  | Writes                                                                                                                                                                 | Fails with                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Manage teams       | `/admin/administration/committees/[id]` → `team-actions.ts` → `admin_*_team`                        | Board, Technical                                                                     | `committee_teams`; moving, deactivating or archiving cancels pending requests with a reason; audit `team.created`, `.updated`, `.moved`, `.status_changed`, `.deleted` | `NAME_TAKEN`, `IN_USE` (deleting a used team), `BLOCKED` (archiving with active appointments), `COMMITTEE_ARCHIVED` |
| Open or close      | Membership → Leadership switch → `set_leadership_requests_open`                                     | Board, Technical                                                                     | `verification_settings.leadership_requests_open`; audit `leadership.requests_opened` or `.requests_closed`                                                             | `FORBIDDEN`, `UNCHANGED`                                                                                            |
| Request a position | `POST /v1/me/leadership/requests` (website profile; `teamId` null for committee leadership)         | A member, while requests are open                                                    | `leadership_requests` (`pending`); audit `leadership.requested` with the level                                                                                         | `REQUESTS_CLOSED`, `HIERARCHY_MISMATCH`, `TEAM_INACTIVE`, `COMMITTEE_ARCHIVED`, `ALREADY_PENDING`, `RATE_LIMITED`   |
| Decide             | Dashboard `/admin/membership/leadership/[id]` → `decide_leadership_request`                         | Leadership reviewers, not about themselves                                           | On approval a `leadership_appointments` row (`source = request`); audit `leadership.approved` or `.rejected`                                                           | `SELF_REVIEW`, `POSITION_FULL`, `STALE_STRUCTURE` (team moved), `STALE_REVISION`                                    |
| Appoint directly   | Committee page (Committee leaders, or a team) → `assign_leadership`                                 | Leadership reviewers (on the page: Board), not themselves                            | Appointment (`source = direct`); audit `appointment.created`                                                                                                           | `POSITION_FULL`, `PENDING_REQUEST`, limits                                                                          |
| Change or revoke   | Committee page or request detail → `update_leadership_appointment`, `revoke_leadership_appointment` | Leadership reviewers (Board Administration, Society Affairs). Never about themselves | Position change or `ended_at` with a member-facing reason; audit `appointment.updated` or `.revoked`                                                                   | `SELF_REVIEW`, `POSITION_FULL`, `STALE_REVISION`                                                                    |

Approvals and structure changes take one exclusive lock, so two approvals for one position in one
scope (the committee itself or one team) cannot both succeed. Closing requests stops new ones only:
pending requests can still be decided and appointments stay visible. **No step writes `administrative_access`.** A Chief or Assistant Chief has no
dashboard access unless `/admin/access` grants it separately.

## Committee and team permissions (0035, ADR 0027)

```mermaid
flowchart LR
  PM["Holder of permissions.manage"] -->|"Administration → Permissions<br/>set_group_permissions"| G["Committee or team<br/>configuration"]
  G -->|"active appointment in that scope"| L["Chief / Assistant Chief"]
  G -->|"committee configuration"| CM["Committee Manager<br/>of that committee"]
  LV["Personal level<br/>(fixed mapping)"] --> P["Effective permissions<br/>get_dashboard_access"]
  L --> P
  CM --> P
  P -->|"every routine re-checks<br/>has_permission"| D["Dashboard pages, actions, routines"]
```

1. A holder of `permissions.manage` opens Administration → Permissions, picks a committee or a
   team, ticks permissions (own committee or all committees where scopable), reviews the preview
   of affected leaders and saves. Full access and changes to `permissions.manage` ask for
   confirmation. The change is audited and applies on each leader's next request.
2. A member approved as Chief or Assistant Chief receives their scope's configuration from the
   moment the appointment exists; revocation, a team made inactive or an archived committee ends
   it. Pending requests never grant anything. The website profile shows which positions give
   dashboard access.
3. Nobody changes their own group's configuration, and no change may leave the society without an
   account able to manage permissions and administrator access.

## Email Centre (0036, ADR 0028)

```mermaid
sequenceDiagram
  participant S as Sender (email.send)
  participant C as Core
  participant DB as PostgreSQL
  participant T as Transport (deferred provider)
  S->>C: draft, filters, preview (25 per page)
  C->>DB: email_save_campaign / email_audience_preview
  S->>C: confirm N recipients
  C->>DB: email_queue_campaign(expected N): one delivery per recipient
  loop each bounded batch (page open, or the dispatch route)
    C->>DB: email_claim_deliveries: recheck sender and recipients, lease
    C->>T: one message per recipient, idempotency key = delivery id
    C->>DB: email_complete_delivery: accepted / retry / failed
  end
```

1. The sender builds the audience from member data (category, self-reported institution,
   academic year, discipline, interests, membership status, SQU verification, leadership
   position, committee and team, plus individual inclusions and exclusions) and sees the count
   and a searchable page of recipients. Unsubscribed and suppressed addresses are always left out.
2. They write the message in English, Arabic or both, preview it as a recipient sees it, save a
   draft or template, and send themselves a test.
3. Sending asks them to confirm the exact count; queuing recounts and refuses a changed audience.
4. Batches of 25 run while the page is open, or whenever a scheduler calls
   `/v1/internal/email-dispatch`. Before each send the sender's permission and the recipient's
   eligibility are rechecked: a sender who lost `email.send` halts the rest of the campaign.
5. Temporary failures retry with back-off up to five attempts; permanent ones are listed with
   their reason, and invalid addresses are suppressed. "Accepted" is not "delivered" until the
   provider reports delivery. Members unsubscribe from the link in every message or on their
   profile.

Sending is off until a provider, sender address and secrets are configured; see
[Email Centre](../how-to/email-centre.md).

## Sign-in, sessions, sign-out and recovery

| Audience        | Sign-in                                                               | Session                                                                                                                        | Recovery                                                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard users | `/admin/login` → `loginAction` (`signInWithPassword` on the server)   | Supabase SSR cookies on Core's origin, refreshed by `proxy.ts`. Access is re-read from the database on every request.          | `/admin/recovery` → email to `AUTH_REDIRECT_ORIGIN/auth/callback` (PKCE code needs the same browser; token-hash links work anywhere) → `/auth/reset` → new password → recovery session ended → `/admin/login?reset=success`. `AuthHashRelay` converts `#access_token` links sent from the Supabase dashboard. |
| Website members | Website `/login` in the browser (`signInWithPassword`, implicit flow) | Browser storage on the website's origin. Core receives only the Bearer access token, verified per request with `auth.getUser`. | Website `/forgot-password` → email to `<site>/reset-password` → recovery verified in that page load → new password → global sign-out                                                                                                                                                                          |

- **Sign-out.** Dashboard: `logoutAction` (`supabase.auth.signOut()`). Website: local sign-out,
  or global after a password reset.
- **Revocation.** Revoking dashboard access ends authorization on the next request. Core does not
  invalidate the user's Auth session (ADR 0014).
- **Messages.** Both apps answer "no account" and "wrong password" the same way, and give the same
  recovery answer for every address.
- **Dependencies.** Supabase Auth settings (Site URL, redirect allow-list, token-hash templates,
  custom SMTP) are configured in the Supabase dashboard and documented in
  [`AUTH_AND_EMAIL.md`](../AUTH_AND_EMAIL.md).

## Events

`review` and `approved` are draft events with `review_required = true`, shown as their own states
by [`lib/admin-events/status.ts`](../../lib/admin-events/status.ts). "Past" is derived once
`event_date` passes.

```mermaid
stateDiagram-v2
  [*] --> draft: save_event_details (create)
  draft --> review: flag_review
  review --> draft: unflag_review
  review --> review: reject_review (clears approval)
  review --> approved: approve_event
  approved --> review: an edit re-flags and clears approval
  draft --> published: publish_event (no review required)
  approved --> published: publish_event
  published --> full: hold_event_full (upcoming only)
  full --> published: reopen (publish_event)
  draft --> archived: archive_event
  published --> archived: archive_event (only after event_date)
  full --> archived: archive_event (only after event_date)
  note right of archived
    restore_event clears archived_at
    and keeps the stored status
  end note
```

- **Who.** Any active level within committee scope creates, edits and runs the lifecycle. Only
  Board or Technical approve or reject review-required events, and never as the current review
  subject.
- **Edits.** Editing review-relevant fields re-flags the event and clears an earlier approval.
  Every lifecycle routine checks `expected_revision`, locks the event row, increments `revision`
  and writes one audit row (`event.*`).
- **Archived committees** cannot receive new events (trigger `events_committee_not_archived`).
- **Covers and phone.** `saveEventAction` uploads a JPEG or PNG cover (≤ 3 MiB, re-encoded) to the
  event bucket before saving. It removes the new object if the save fails, and removes the old
  object after a replacement. `phone_required` forces registrants to give a phone number.

**Archive and restore.** `archive_event` accepts drafts, and published or full events only after
their date (`INVALID_TRANSITION` otherwise). `restore_event` clears `archived_at` and keeps the
stored status. Publishing a review-required event without an approval for the current revision
returns `APPROVAL_REQUIRED`.

### Registration, capacity and waitlist

| Rule                                                                                                                  | Where                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Only `published` or `full`, unarchived events accept registrations                                                    | `register_for_event_seat`                               |
| Registration closes at `event_date`                                                                                   | same                                                    |
| `register` only when not full; `join_waitlist` only when full (status `full`, capacity reached, or a waitlist exists) | same                                                    |
| One active registration per email per event; one per member per event                                                 | Partial unique indexes                                  |
| Guests: 20 attempts per IP per 10 minutes; members: 10 per member per 10 minutes                                      | `guest_registration_limit`, `member_registration_limit` |
| Phone required when `phone_required`                                                                                  | `register_event_guest`, `register_event_member`         |
| Members register with their verified profile, and guest registrations with their confirmed email are linked to them   | `register_event_member`, `link_member_registration`     |

- **Waitlist promotion** (`promoteWaitlistAction` → `private.promote_waitlist`) is first in,
  first out. The organizer must attest that they contacted the person. It writes
  `registration.promoted`.
- **CSV export** of confirmed or waitlisted registrations (`POST …/registrations/export`) is
  bounded (10,000 rows or 10 MiB) and refused if counts change mid-export. It is audited as
  `registrations.exported` with a bounded snapshot.

### Attendance

1. An organizer opens check-in for a window of at most 12 hours (`manage_event_checkin`
   `open`). A random secret is stored, and each minute's code is
   `sha256(secret:minute)`.
2. Every organizer screen shows the same code. "Rotate" replaces the secret, which revokes all
   outstanding codes; "close" ends the session.
3. A member scans a QR code that opens `PUBLIC_WEBSITE_ORIGIN/events/{id}/attendance#checkin=…`,
   signs in, and presses confirm (`POST /v1/me/events/{id}/attendance`). The code is accepted for
   the current minute and the two before it.
4. `confirm_member_attendance` sets `attended`, `checked_in_at` and `checkin_method = 'qr'`, and
   writes `attendance.confirmed`. Repeats return the original time.
5. Organizers can record or undo attendance manually for confirmed registrations, never their
   own, with fixed reasons (`record_manual_attendance`; audit `attendance.manual_*`).
6. The attendance CSV is limited to 10,000 rows, includes a method column and excludes phone
   numbers.

## Projects

```mermaid
stateDiagram-v2
  [*] --> draft: create (member)
  draft --> draft: save
  draft --> submitted: submit
  rejected --> draft: save
  changes_requested --> draft: save
  submitted --> under_review: start_review (reviewer)
  under_review --> approved: approve (attestation, not author or team)
  under_review --> rejected: reject (feedback required)
  under_review --> changes_requested: request_changes (feedback required)
  approved --> approved: publish (published_revision = revision)
  approved --> draft: save after publication (public snapshot kept until re-approval)
```

- **Authors** are email-confirmed members with status `member`, with at most 20 open projects
  each.
- **Reviewers** are the Society Affairs manager, Board and Technical (`project_reviewer`).
- **Publication.** `publish` copies the approved revision into `published_content`. `unpublish`
  removes it from public reads immediately: the website reads with `no-store`.
- **Media.** Up to 12 stored images per project and 6 selected per revision. An image used by the
  working or published snapshot cannot be deleted.
- **History.** Every step adds a `project_history` row, and authors follow decisions there. No
  email is sent.
- **Deletion.** Permanent deletion requires the project to be unpublished first (see below).

## Committees, rosters and access

| Operation                             | Who                                                                     | Rules                                                                                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create committee                      | Board, Technical                                                        | Unique name ignoring case; a slug in the required format, fixed at creation; optional description                                                                                                                                                          |
| Edit committee                        | Board, Technical                                                        | Name and description only                                                                                                                                                                                                                                  |
| Archive committee                     | Board, Technical                                                        | Refused for `society-affairs` and `technical-team` (`PROTECTED_COMMITTEE`), and while active managers or upcoming live events exist (`BLOCKED`). Archived committees keep their records but accept no new events, grants, reactivations or roster changes. |
| Restore committee                     | Board, Technical                                                        | Clears `archived_at`                                                                                                                                                                                                                                       |
| Roster add, update, remove            | Board, Technical                                                        | Members only; a responsibility of 1–120 characters; grants nothing                                                                                                                                                                                         |
| Grant or reassign a Committee Manager | Technical; Board (not on Board or Technical accounts)                   | One grant row per user; a manager has exactly one committee; reassignment moves it atomically; the committee must not be archived                                                                                                                          |
| Replace a manager                     | Board, Technical                                                        | Revokes the old grant and grants the new one, with two correlated audit rows; the replacement must have no active access                                                                                                                                   |
| Suspend or reactivate                 | Technical; Board for managers only                                      | A suspension is a revocation with `revocation_kind = 'suspended'`. Reactivation restores the same level and committee, unless the committee is archived.                                                                                                   |
| Grant or revoke Board                 | Technical                                                               | Audited                                                                                                                                                                                                                                                    |
| Grant, revoke or suspend Technical    | Technical                                                               | The last active Technical account cannot be removed (`LAST_TECHNICAL_ADMIN`)                                                                                                                                                                               |
| Create or invite an account           | Technical: any role. Board: no role or Committee Manager, by invitation | Auth Admin API, then the access routine. An account alone grants nothing.                                                                                                                                                                                  |
| Temporary password, reset email       | Technical                                                               | Auth Admin API; the password is never stored or logged; audited                                                                                                                                                                                            |

All access changes serialize on a shared lock, write audit rows in the same transaction, and take
effect on the next request.

## Archive versus permanent deletion

| Record                   | Reversible option   | Permanent deletion                                                                                                                                                                                                                                                                                                                                                                                 | Who              |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Event                    | Archive and restore | Allowed for archived events, and for unarchived drafts without registrations. Blocked by `EVENT_ACTIVE`, `EVENT_HAS_REGISTRATIONS` or `CERTIFICATES_EXIST`. Deletes the event, its registrations (personal data) and its check-in session; queues the cover.                                                                                                                                       | Board, Technical |
| Project                  | Unpublish           | Requires unpublished (`PROJECT_PUBLISHED` blocks). Deletes the project, its history and media rows; queues the images.                                                                                                                                                                                                                                                                             | Board, Technical |
| Committee                | Archive and restore | **Not available**                                                                                                                                                                                                                                                                                                                                                                                  | —                |
| Membership record        | none                | Deletes the member row, applications and ID cards, correction requests, roster places, photo and rate-limit rows. Registrations are **anonymized**, not deleted. The Auth account remains. Blocked by `MEMBER_HAS_PROJECTS` or `LEGACY_RECORDS`. Requires the actor's password.                                                                                                                    | Board, Technical |
| Account (erasure)        | Revoke access       | Everything in the membership record deletion, plus the revoked grant row, pseudonymized audit rows (`actor_kind = 'erased'`, IDs nulled in JSON, notes removed), then deletion of the Auth identity. Blocked by `ACTIVE_ACCESS` (revoke first) and `ACCOUNTABILITY_RECORDS` (the identity anchors grants, reviews, approvals, project decisions or policy changes). Requires the actor's password. | Technical        |
| Application under review | none                | **Not available**                                                                                                                                                                                                                                                                                                                                                                                  | —                |
| Audit rows               | none                | **Never deleted.** Only erasure pseudonymization may update them.                                                                                                                                                                                                                                                                                                                                  | —                |

**Common to every permanent deletion:**

1. A preview lists everything affected and every blocker (`preview_*_deletion`).
2. The actor types the record's name, title or email.
3. The deletion runs in one database transaction (`delete_*`, `erase_account`). Storage objects
   are queued in `membership_storage_deletions` and deleted afterwards by the queue processor.
4. **Account erasure only.** The database part commits first and records
   `private.account_erasures`. The server then deletes the Auth identity with the service-role
   key, and `complete_account_erasure` confirms it. If the Auth call fails or the key is missing,
   the erasure stays **pending** and is retried from the Administration overview
   (`retryErasureAction`).

No one can delete their own records.
