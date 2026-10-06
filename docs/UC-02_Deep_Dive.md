# UC-02: Event announcement, registration, and committee administration

**Access revision (October 4, 2026):** The owner has specified a three-level
application hierarchy, a single committee per ordinary manager, and global
Board/Technical review authority. See [ADR 0012](adr/0012-application-access-hierarchy.md)
and the [access contract](ACCESS_CONTROL.md). The manager-only access text below
records the deployed UC-02 baseline; those access clauses are superseded by
the new specification; its migration is applied. Section 11 below records
the updated O-01 reviewer decision.

**Specification revision:** 3, September 15, 2026.
**Historical freeze gate:** O-01 was originally answered with per-committee
two-manager review; ADR 0012 supersedes reviewer authority (section 11).
This revision, both companion contracts, and the section 15 checklist
were committed at `9c5b733` and confirmed green in CI. Implementation followed
the dependency-ordered roadmap.

## 1. Authority, evidence, and current implementation

This is the UC-02 behavior specification. Its companion
[data and security contract](UC-02_Data_and_Security.md) owns fields, database
guarantees, authorization, and RLS. The
[acceptance and delivery plan](UC-02_Acceptance_and_Delivery.md) owns test IDs,
milestones, and completion evidence. Read all three before implementing.
ADR [0008](adr/0008-uc02-specification-contract.md) records the design boundary.

Sources, in precedence order:

1. Current explicit owner instructions, including the specification gate and
   preferred defaults on September 15, 2026.
2. Requirements PDF v1.0: FR-03/04 (p3), NFR-01 through NFR-10 (p4),
   UC-02 (p7). Later written decisions supersede specific older details only.
3. Technical Blueprint v1.0, pp3–5, and ADRs 0001–0007; CLAUDE.md's
   accountless registration and committee dashboard decisions.
4. Deliberate existing contracts, then the explicitly identified defaults below.

The PDF main flow is preserved: committee publishes title/date/description;
the website discovers it automatically; the visitor opens the event and
registers on that page; the database persists it; the same page confirms it.
The PDF explicitly requires a waitlist when full and draft holding when review
is required. The owner's preferred no-waitlist baseline is conditional on no
contrary requirement; that condition is not met here.

### Recovery baseline (observed, not a claim of completeness)

- Branch main, HEAD cd6fb4d; no tracked changes before this milestone.
- Public list, form, Server Action, domain/query modules, basic name/email
  validation, and table-backed IP limiter exist. No admin/auth UI exists.
- No duplicate constraint, capacity field, closing-time check, waitlist,
  ownership grant, audit trail, or registration concurrency control exists.
- Event enum deliberately contains draft/published/full. Full currently hides
  an event; the target below makes announced full events visible.
- Member link is already nullable; captured name/email already required.
  Attendance and certificates are schema only, with no implementation.
- Staging wnrdgnmmcdedmilnzzsl: eight tables, RLS enabled, only anon published
  event SELECT and anon registration INSERT policies. One normalized
  event/email duplicate group exists. The current test adds duplicate fixtures.
- Main project rbeyqrfypowyocmnmvwu: this initial preflight reported RLS
  disabled on eight tables. Live catalog inspection on September 24 corrected
  the report: all ten UC-02 tables had ENABLE/FORCE RLS before the main-project
  migration cutover (acceptance/delivery M8 evidence).
- Migration SQL 0002 was applied to staging through Supabase but is absent
  from the Drizzle journal. The future reconciliation must preserve both
  histories and explicitly adopt the historical changes.

No schema, policy, or live application change is effected by this specification.

## 2. Scope and decision register

P = PROJECT-BACKED DECISION (including the owner's explicit preferred baseline
where no contrary approved decision exists).
D = INDUSTRY-DERIVED DEFAULT selected under the owner's gap-resolution authority;
it is a project choice, not a claim that every event platform behaves this way.

| ID  | Decision                                                                                                                                                                                                                                                                         | Basis                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P01 | Accountless registration, exactly name/email; memberId nullable, no fake Member, no historical linking                                                                                                                                                                           | ADR 0004                                                  |
| P02 | One active entry per event and normalized email; repeat produces a safe result without overwriting identity                                                                                                                                                                      | Owner baseline                                            |
| P03 | Required title/date/description at publication; committee ownership required                                                                                                                                                                                                     | FR-03, UC-02, existing FK                                 |
| P04 | Optional positive capacity; confirmed entries alone consume seats; no capacity means no numerical limit                                                                                                                                                                          | Owner baseline                                            |
| P05 | Retain persisted draft/published/full enum; full is a manual admission hold; numerical fullness is derived                                                                                                                                                                       | Existing deliberate enum; section 4 disambiguates         |
| P06 | Waitlist option is required; opt-in is explicit, not a silent substitute for a seat                                                                                                                                                                                              | UC-02 p7; D02                                             |
| P07 | Close registration and waitlist joining at event start; no new deadline field                                                                                                                                                                                                    | Owner baseline                                            |
| P08 | Committee managers can view/manage only their own scope; event-scoped CSV allowed                                                                                                                                                                                                | NFR-03/04, owner baseline                                 |
| P09 | No domain hard deletion; every domain mutation and export is audited                                                                                                                                                                                                             | NFR-01/02                                                 |
| P10 | Registration confirmation is on-page; no UC-02 registration email, email queue, or Resend dependency                                                                                                                                                                             | UC-02 p7, Blueprint p3, ADR 0003                          |
| P11 | No UC-03 check-in or UC-04 issuance UI; both must use Registration identity in the future                                                                                                                                                                                        | Current build order, ADR 0004                             |
| P12 | O-01: per-committee two-manager review. Owning manager flags a draft review-required; a different manager holding an active grant on the same committee approves the current revision; editing reviewed fields invalidates approval; non-flagged drafts publish with one manager | Owner decision, September 15, 2026, section 11            |
| D01 | Platform event timezone Asia/Muscat; store UTC instant, display explicitly in Oman time                                                                                                                                                                                          | SQU context; one timezone avoids ambiguous local input    |
| D02 | FIFO waitlist; manager promotes one at a time after confirming contact; no automatic offers/expiry                                                                                                                                                                               | Required waitlist, smallest operator-assisted fulfillment |
| D03 | Supabase Auth identities plus explicit committee manager grants, independent of Member                                                                                                                                                                                           | NFR-03 and UC-01 deferral                                 |
| D04 | Future published events retain public visibility when full; past events have a separate browsable list                                                                                                                                                                           | UC-02 discovery, permanent history                        |
| D05 | Archive drafts or past events; no future published archive, cancellation, self-cancellation, transfers, or rescheduling after first entry in UC-02                                                                                                                               | Minimal reversible lifecycle                              |
| D06 | Event details frozen at first entry except title/description/location corrections and safe capacity changes; audit and contact warning on corrections                                                                                                                            | Protect existing attendee commitments                     |
| D07 | Anonymous writes only through the trusted Server Action and restricted database operation, never raw anon INSERT                                                                                                                                                                 | Closes observed rate-limit bypass                         |
| D08 | Database row locks serialize seats and edits; normalized partial uniqueness handles duplicate races                                                                                                                                                                              | PostgreSQL guarantee, NFR-06                              |
| D09 | Small cursor pages and event-scoped snapshot CSV; no global export or analytics                                                                                                                                                                                                  | Owner baseline, NFR-07                                    |
| D10 | Required technical logging is isolated from attendee history; raw IP attempts expire after one hour                                                                                                                                                                              | ADR 0005 explicitly anticipates cleanup                   |

**Excluded:** payments, ticket types, attachments/posters, private invitation
events, recurring events, public accounts, public attendee lookup, marketing
subscriptions, analytics, profile linking, attendance editing, certificate
issuance, public cancellation, event cancellation/rescheduling workflows,
committee provisioning UI, and global board administration.

Operational event cancellation is not simulated by changing its date, deleting
it, or silently removing registrations. If needed before a later approved
workflow exists, it requires an owner-directed, audited intervention and
communication outside this feature.

## 3. Registration and waitlist lifecycle

### Identity, eligibility, validation

Any visitor may register: no university-domain restriction, university ID,
phone, Member lookup, proof of membership, or automatic account creation.
Being logged in does not change public registration or link it to an account.
One email represents one active place per event; group bookings are excluded.

Name: trim surrounding Unicode whitespace; 1–200 Unicode code points;
accept Arabic, apostrophes, hyphens, spaces and other scripts; reject control
characters. Do not transliterate or impose a two-word-name rule.
Email: trim, lowercase the entire address; maximum 254 ASCII characters;
one @, nonempty local/domain, dotted domain, no whitespace/control characters.
Use the same existing practical email-pattern rule on server and database;
it is syntax checking, not verification of mailbox ownership.
Do not collapse plus tags or provider-specific dots. Non-ASCII email addresses
receive a clear unsupported-address validation message; international names
remain supported. Database CHECK rules match the canonical stored form.

The server accepts only eventId (UUID), attendeeName, attendeeEmail, and intent
(register or join_waitlist). No accepted client field for memberId, status,
attendance, timestamps, capacity, actor, committee, or registration ID.
Reject non-string values, duplicate form keys for these fields, and malformed
IDs. Framework action metadata is handled separately from domain fields.

### Normal registration

1. Validate transport/body limits and obtain trusted request IP.
2. Apply the persisted limiter, including malformed submissions.
3. Validate domain fields, then execute the atomic operation in the data contract.
4. For a visible event, look for an active duplicate before deciding whether
   it is now closed/full. Never look up duplicates for hidden events.
5. A confirmed duplicate returns ALREADY_REGISTERED; a waitlisted duplicate
   returns ALREADY_WAITLISTED. Superseded legacy rows are not active.
6. If event start has arrived, reject new entries.
7. If admission is open and no waitlist is pending, create one confirmed entry.
8. Otherwise return EVENT_FULL and show an explicit Join waitlist option.

An ALREADY_REGISTERED response never returns the stored name, email,
registration ID, attendance, timestamps, or Member link. It does reveal that
the submitted email already has an entry, as required by the owner's baseline;
there is no public lookup endpoint, and repeats consume the same abuse budget.
Name differences on retries never overwrite the stored name.

### Waitlist

Join waitlist uses the same fields and rate limit, with explicit intent.
It creates a waitlisted Registration with no seat and no attendance eligibility.
Order is ascending (registeredAt, id); ties are broken by UUID, not client time.
All active entries share one event/email uniqueness rule.

If space reopened and the queue is empty, a stale join_waitlist request returns
REGISTRATION_AVAILABLE without writing: the visitor explicitly chooses Register.
If a queue exists, new visitors join its tail even if numerical capacity has
increased. Pending waitlisted people have priority over new direct registration.
Public UX says “Registration is currently full or places are being allocated
to the waitlist.” It never exposes queue position, size, or another attendee.

Managers can see the FIFO list and promote only its first entry, only before
start, only when status is published and capacity permits. Manual full must
be reopened first. They confirm they have contacted the attendee and received
acceptance; the promotion audit stores that attestation, not the contents of
private correspondence. Contact occurs through existing committee channels.
The app does not send or promise automated email. No automatic expiry, silent
promotion, skip, or cancellation is implemented. If the first person cannot
be reached, the queue stays pending; adding release/decline/expiry behavior is
a future product change, not an implementation shortcut.

Promotion changes the existing row to confirmed, preserves registeredAt and
identity, consumes one seat, and is idempotent on retry. At/after start,
unpromoted rows remain historical waitlisted entries, never attendees.

### Failure and permanence

Closing a tab before submit writes nothing. A committed entry survives a lost
response. A repeated request returns the duplicate outcome. A failed
transaction writes neither entry nor audit change. Limiter bookkeeping may
persist independently. No automatic email failure can affect this flow because
UC-02 does not send registration email. There is no registration cancellation
or identity editing UI in this scope.

## 4. Event lifecycle and edits

Only draft, published and full are persisted statuses. full means the existing
manual admission hold, not an authoritative stored count. No job writes full
when capacity is reached. Numerical fullness, waitlist allocation, past and
archived are derived conditions, with archivedAt recording the archive action.

Priority for visibility/admission: archived -> draft -> past -> manual full ->
numerically full or queue pending -> open. At exact start, the event is past
for registration purposes. There is no end time in the approved model.

| Condition                                                    | Public display            | New confirmed entry | Join waitlist                 |
| ------------------------------------------------------------ | ------------------------- | ------------------- | ----------------------------- |
| archivedAt set                                               | Hidden; public 404        | Deny                | Deny                          |
| draft                                                        | Hidden; same public 404   | Deny                | Deny                          |
| published, starts in future, capacity available, queue empty | Open                      | Allow               | Return REGISTRATION_AVAILABLE |
| published, capacity reached                                  | Full                      | Deny                | Allow before start            |
| published, queue pending, even with spare capacity           | Waitlist allocation       | Deny                | Allow before start            |
| full, starts in future                                       | Full (manual hold)        | Deny                | Allow                         |
| published or full, start <= database time                    | Past, registration closed | Deny                | Deny                          |

| Transition/action              | Actor and guard                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Create -> draft                | Owning manager; all create fields valid                                                                                                      |
| draft -> published             | Owning publisher; future start; nonempty description; reviewRequired false, or approvedBy set by a different manager at the current revision |
| published -> full              | Owning manager; future event; confirmation warns that normal registration stops                                                              |
| full -> published              | Owning publisher; future event; same review predicate as draft->published; capacity and queue still control admission                        |
| published/full -> draft        | Only before any registration/waitlist entry; otherwise deny                                                                                  |
| draft/past -> archived         | Owning manager; explicit confirmation; retain status, identity and history                                                                   |
| archived -> previous status    | Owning manager; restore draft or past only; never reopens a past event                                                                       |
| Edit event                     | Owning manager; expected revision matches; rules below                                                                                       |
| Hard delete event/registration | Deny all application actors                                                                                                                  |

Create requires title (trimmed 1–200 code points), eventDate (valid future
minute-precision instant), committeeId from a current manager grant; description
(plain text, at most 10,000 code points) and location (plain text, at most 500)
may be blank/null in drafts. Description must contain non-whitespace text at
publication. Location is optional; “Location to be announced” is display-only,
never a fabricated stored value. No HTML rendering or automatic URL embedding.
Capacity is null or integer 1–2,147,483,647; zero, fractions and negatives fail.

Managers enter date/time in explicitly labeled Asia/Muscat; no browser-timezone
guessing. ISO values crossing server boundaries carry Z or an explicit offset.
Display includes Oman time (UTC+04:00); sorting and all closing decisions use
instants. No stored timezone column for a single-zone product.

committeeId is immutable after creation. eventDate is immutable once any
entry exists (including waitlist/history); before that it can change only to a
future time. Published-event title/description/location corrections show an
explicit warning to notify affected people through committee channels.
Archived records are read-only until restored. Past event corrections are
limited to title/description/location; capacity/date/status cannot reopen them.

Capacity changes take the same event lock as registration/promotion and cannot
go below the confirmed count. Removing capacity means unlimited, but preserves
waitlist priority. No bulk automatic promotion on increasing capacity.
All mutations use an expected integer revision and return CONFLICT if stale.
No silent last-write-wins overwrite. Editing title/description/location/
eventDate/capacity while reviewRequired is true clears approvedBy/approvedAt/
approvedRevision under the same lock, forcing re-approval of the new revision;
reviewRequired and flaggedBy are untouched by that edit.

## 5. Committee identity and administration

Supabase Auth login is for committee administrators only in UC-02. It does not
create a Member profile. Existing organizational names (board, committee head,
technical lead) confer no implicit application privilege.

Use one capability, committee manager, assigned explicitly to an auth user for
one committee. A user may hold multiple independent grants. Membership and
revocation are read from the database on every operation, never from
user-editable metadata or a cached role claim.

The owner provisions named users and grants through a documented maintenance
procedure; no self-enrollment or delegation UI. Revocation is a recorded state
change, not row deletion. The first real grant must identify a person and
committee; never seed blanket grants to all authenticated users.

Login uses Supabase email/password for provisioned accounts with confirmed
email. No public signup UI. Password reset/invitation uses Supabase Auth with
the established Resend SMTP integration when configured, fixed allowed
redirects, generic result copy, and Auth rate limits. This operational auth
mail is separate from optional event confirmation. Auth SMTP/provider setup is
a release prerequisite, not a reason to build UC-01.
After login, an account without a live grant sees “No committee access assigned.”
Logout clears cookies; expired sessions redirect to login with only an allowlisted
internal return path. Authorization runs again inside every action/export.

| Screen                           | Fields, states and operations                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /admin/login                     | Email/password, pending, generic invalid credentials, reset request; no signup                                                                            |
| /admin/events                    | Authorized committee selector, title/date/status, confirmed and waitlisted counts; filter draft/published/full/past/archived; cursor navigation           |
| /admin/events/new                | Title, description, Oman date/time, location, capacity, authorized committee; save draft                                                                  |
| /admin/events/[id]               | Current revision, edit form, mark/unmark review-required, approve (only a different committee manager), publish/full/reopen/archive/restore, confirmation |
| /admin/events/[id]/registrations | Confirmed/waitlisted tabs, name/email/time, counts, CSV; FIFO promotion in waitlist tab                                                                   |

No search in first release: pagination plus event/status filters satisfy current
scope without indexing attendee names/emails for speculative search.
Empty event list offers Create event. Empty registrations say “No registrations
yet.” Loading uses labeled pending states; failures preserve form input for retry.
Cross-committee IDs show the same not-found view as missing IDs and never load
their counts, titles, drafts, emails, exports or audit rows.

CSV is event-scoped, selected confirmed or waitlisted tab, entire selected
dataset at one database snapshot (not just the displayed page). Columns:
Attendee name, Attendee email, Registration status, Registered at (UTC).
No internal IDs, Member data, IPs, attendance or unrelated committee fields.
UTF-8 with BOM, CRLF rows, quote every cell and double embedded quotes.
Neutralize spreadsheet formula prefixes (=, +, -, @, tab, CR, LF, including
after leading whitespace) by prefixing a text apostrophe. Do not alter stored
data. Attachment filename is server-generated from event UUID and UTC date,
not untrusted title. Send no-store and nosniff. Download requires POST with
origin/session checks; audit authorization and export snapshot/row count before
returning bytes. If audit/write/query fails, return no file.

## 6. Public UX

/ lists upcoming events in ascending (eventDate, id) order, 20 per page.
An explicit Past events link uses descending order and the same page size.
/events/[id] contains event details and the inline registration/waitlist form;
the list links here, satisfying “opens the event” without an external form.
Draft/archived/unknown/malformed IDs use an indistinguishable public 404.
Full future events remain listed. No automatic polling or realtime needed.

Render current data per request. A committed publish/correction appears on the
next fresh request without a rebuild. Mutation outcomes refresh the relevant
availability/counts. An already-open page may be stale; the transaction decides.
Never show “nothing published” when the database is unavailable: show a retry
error. No PII in metadata, URLs, analytics, client logs or public payloads.

Use visible labels, autocomplete=name/email, type=email, associated inline
errors, error summary/focus on failure, and polite status announcements on
success/pending. Preserve valid fields after error; disable duplicate submit
while pending. Keyboard and screen reader flows must work. At 320px width,
no horizontal page scroll; admin tables may have an explicitly labeled scroll
region. Forms support non-Latin names and bidirectional text.
Primary action is Register, Join waitlist, or a disabled closed state, never a
misleading Register button on a closed event. Reloading loses local confirmation
but a retry is safe; no public identity lookup or PII in local storage.

## 7. Stable result contracts and copy

Public domain result is a discriminated union keyed by code. Only
VALIDATION_ERROR includes fieldErrors (name, email, eventId, intent); no raw
database Error crosses the boundary. Internal IDs appear only in admin DTOs.

| Code                   | User-visible behavior                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| SUCCESS                | “You're registered. Your place is confirmed.” Replace form with persistent on-page status                           |
| ALREADY_REGISTERED     | “This email is already registered for this event. No second registration was created.”                              |
| WAITLISTED             | “You're on the waitlist, not yet registered for a place. The committee will contact you if a place can be offered.” |
| ALREADY_WAITLISTED     | “This email is already on the waitlist. No second entry was created.”                                               |
| EVENT_NOT_FOUND        | “This event is unavailable.” Link to event list                                                                     |
| EVENT_NOT_PUBLISHED    | Internal classification only; map to EVENT_NOT_FOUND publicly                                                       |
| REGISTRATION_CLOSED    | “Registration has closed because this event has started.”                                                           |
| EVENT_FULL             | “Registration is full or places are being allocated to the waitlist.” Offer explicit join                           |
| REGISTRATION_AVAILABLE | “Registration is open again. Choose Register to confirm your place.”                                                |
| VALIDATION_ERROR       | Specific safe field messages; no write; retain fields                                                               |
| RATE_LIMITED           | “Too many attempts from this connection. Try again after 10 minutes without another attempt.”                       |
| SERVER_ERROR           | “We couldn't confirm the result. Try again; retrying won't create another entry.”                                   |

Public precedence: transport rejection, rate limit, field validation, visibility,
active duplicate, start time, admission/intent, atomic commit.
Admin precedence: authentication, scoped authorization (missing/foreign -> NOT_FOUND),
validation, revision, business guards, commit. Admin codes: SUCCESS,
AUTH_REQUIRED, FORBIDDEN (no grants), NOT_FOUND, VALIDATION_ERROR, CONFLICT,
APPROVAL_REQUIRED (reviewRequired true and not approved at the current
revision), SELF_APPROVAL_DENIED (actor equals flaggedBy), INVALID_TRANSITION,
CAPACITY_BELOW_COUNT, QUEUE_ORDER_CONFLICT, REGISTRATION_CLOSED, EVENT_FULL,
EXPORT_LIMIT_EXCEEDED, SERVER_ERROR.
Promoting an already-confirmed row returns SUCCESS with no second audit mutation;
stale form edits return CONFLICT and require reloading. Re-approving an
already-current approval is likewise SUCCESS with no second audit row.
Authorization always precedes these idempotency checks.

## 8. Abuse protection, privacy and audit

Keep ADR 0005's five attempts per IP in ten minutes across all events/intents.
The sixth is rejected. Count and log every parsed action attempt, including
validation failures and duplicates. Apply a per-IP transaction advisory lock
to remove the documented count/insert race. Use database time.
Rejected attempts also count, so repeated retries extend the rolling block.
Transport-rejected oversized requests never reach the application log.

Only Vercel's trusted forwarding header for the established direct deployment
topology supplies the canonical inet address. Validate IPv4/IPv6; reject
untrusted/missing production IP with SERVER_ERROR and no registration.
Explicit local development can use loopback; never silently use it on Vercel.
Do not accept IP from form fields or an arbitrary proxy chain.
Retain Next's same-origin action protection; cap action bodies at 64 KiB
(ample for these text-only forms); reject unsupported fields/types server-side.
No CAPTCHA initially; distributed abuse may require a later documented change.

Raw IPs stay only in private limiter bookkeeping, purged after one hour by a
small database maintenance job. They are not appended into permanent audit
history. The current one-row-per-attempt growth is explicitly retired on
cutover. Public writes and direct database/API grants must enforce the same
boundary; app-only throttling with raw anon INSERT is not completion.

Attendee data and waitlist history remain private permanent operational records
under NFR-01. Do not use them for marketing, tracking, or a public directory.
Public privacy copy explains name/email, event administration purpose, authorized
committee access, permanent history, no public display, and no automatic Member
profile. No extra consent checkbox that falsely suggests optional processing.
Identity is self-asserted, not email-verified. Data access/correction requests
are handled by the society owner outside this UI; no public data-response
endpoint. Legal retention/erasure changes require a separate owner policy and
must not be inferred from this engineering document.

Every event/registration/grant create or change is logged atomically with
actor and time; anonymous creation records “anonymous registrant” and the
registration reference, not a fictional authenticated user. Export is audited.
Audit failure rolls back business writes. Historical pre-audit records are
marked imported with unknown original actor, never fabricated attribution.
Private errors log operation/code/request ID only, not email, name, IP, SQL
parameters, credentials or form payload. Attendee audit rows have the same
committee restrictions as the original data.

## 9. Attendance, certificates and email boundary

UC-03 must target registration.id, not require Member. Display attendeeName
from the captured Registration; Member is optional enrichment. Waitlisted or
superseded rows are not eligible for check-in. UC-02 never accepts attended or
checkedInAt from a public/admin form and does not implement check-in.

Certificate.registrationId remains the single link. A future certificate can
render attendeeName with memberId null; it must not require an inner join to
Member or auto-create one. Delivery/profile association and eligibility belong
to UC-04 and its later specification.

No event confirmation email is sent, retried, queued or deduplicated in UC-02.
Resend outages therefore cannot affect persisted registration or on-page
confirmation. Adding event emails later requires a delivery-status/idempotency
contract before code. Manual waitlist contact is described in section 3.

## 10. Research used to fill gaps

Consulted September 15, 2026:

- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html):
  deny by default and authorize each resource access; informs D03/D07.
- [PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html):
  event row locks serialize cooperating writes; informs D08.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security):
  grants and row policies are separate controls; informs the policy matrix.
- [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client):
  verified identity and request-scoped clients; informs admin login.
- [Vercel request headers](https://vercel.com/docs/headers/request-headers):
  trusted deployment IP handling; informs abuse protection.
- [Eventbrite waitlist management](https://www.eventbrite.com/help/en-us/articles/817355/):
  distinguishes a waitlist entry from an actual admission offer.
  FIFO/manual contact here is our smaller default, not a copied Eventbrite flow.
- Installed Next 16.3.4 data-security and serverActions guides:
  actions need their own authorization and bounded, filtered transport.

No industry source selects the society's board/committee approval authority.

## 11. O-01 — finalized approval model, revised October 4, 2026

The original same-committee second-manager requirement below is historical.
The owner now requires a different `BOARD_ADMIN` or `TECHNICAL` user to approve
or reject a review-required event. Board is the normal reviewer; Technical is
a fallback. An ordinary Committee Manager cannot approve or reject. Reviewer
authority comes from the explicit application access level, not committee
membership. The reviewer must differ from the actor whose current action
requires review; `flaggedBy` identifies that actor and is updated when
review-relevant edits invalidate approval. Self-approval remains prohibited.
Rejection retains a review-required draft, clears approval, increments revision,
and is audited. Approval and rejection audit actor, event, committee, previous
and resulting state, and timestamp. The existing lifecycle guards still apply.

### Historical September 15 decision

**O-01 — Which events need approval, and who approves?**
Requirements p7 says some events may require board or committee approval.
Answered by the owner on September 15, 2026: per-committee two-manager review,
the concrete proposal below. This section is now the specification for that
behavior, not an open question; the companion contracts implement it.

- `reviewRequired` is a boolean on the draft, default false, set by the owning
  manager. Setting/unsetting it uses the same guard as any other draft edit
  (an active grant on the event's committee) and is audited like any edit; it
  is not a separate privileged capability.
- Publishing (draft->published or full->published) requires `reviewRequired`
  false, OR `approvedBy` set by a manager who is not `flaggedBy`, with
  `approvedRevision` equal to the event's current `revision`. Otherwise the
  operation returns APPROVAL_REQUIRED.
- Approve is a distinct admin action, separate from edit and publish. It
  requires an active grant on the event's committee, `reviewRequired` true,
  and the actor is not `flaggedBy` (self-approval returns SELF_APPROVAL_DENIED).
  It sets `approvedBy`/`approvedAt`/`approvedRevision` to the actor, now, and
  the current revision. Re-approving an already-current approval is idempotent
  SUCCESS with no second audit row, matching the waitlist-promotion pattern.
- Editing title/description/location/eventDate/capacity while `reviewRequired`
  is true clears `approvedBy`/`approvedAt`/`approvedRevision` under the same
  lock as the edit ("invalidation"). `reviewRequired` and `flaggedBy` are
  untouched, so the same reviewer relationship stands but must re-approve the
  new revision.
- Board participants are not a separate role: approving requires the same
  explicit `committee_managers` grant on that exact committee as any other
  manager action (D03). There is no global board override and no
  deny-by-default placeholder counts as completing this workflow.
- Audit action names: `event.review_flagged`, `event.review_unflagged`,
  `event.approved` (data contract section 5).

Exact fields, constraints, RLS cells, routine changes and test IDs are in the
[data/security contract](UC-02_Data_and_Security.md) and the
[acceptance/delivery plan](UC-02_Acceptance_and_Delivery.md).

## 12. Release prerequisites (not new product defaults)

The delivery plan must verify approved deployment/database environment mapping,
apply tested RLS to the serving database through an authorized production
change, provision named committee users, configure Auth delivery, test backups
and restoration, and verify application runtime with authenticated tooling.
Vercel READY or a Vercel SSO redirect alone does not prove the application works
or is publicly usable. Do not remove deployment protection before the data
security gate passes.

## 13. Schema changes

Exact planned fields, constraints, migration backfill/preflight, privileges and
transaction entry points are in [the data contract](UC-02_Data_and_Security.md).
No extra field may be added during implementation without updating that contract.
No SQL migration is created during this specification phase.

## 14. Acceptance and delivery

[Acceptance and delivery](UC-02_Acceptance_and_Delivery.md) defines the behavior
tests, security matrix, concurrency schedule, and dependency-ordered milestones.
Passing the specification gate does not mean those implementation tests pass.

## 15. Specification freeze checklist

The October 4 access revision in ADR 0012 adds this gate before access
implementation. The owner has resolved the two policy decisions. Production
identity mapping is an assignment input, not a reason to invent identities.

- [x] Three access levels, exact manager scope and eight catalog entries written.
- [x] Legacy `Events` stays isolated with its smoke history pending verified cleanup.
- [x] Board/Technical reviewer authority and no-self-review rule written.
- [x] RLS, routine, count, export, audit and denial matrix written in the access contract.
- [x] Production pilot and no-placeholder-account order written.
- [x] Access revision committed, pushed and CI verified (commit `b73b6ec`, run `37170504881`).

- [x] Scope, public flow, registration lifecycle and public UX explicit.
- [x] Duplicate, capacity, closing and waitlist rules explicit.
- [x] Ownership, cross-committee access, attendee visibility and exports explicit.
- [x] Nullable memberId, attendance and certificate implications explicit.
- [x] Email, privacy, abuse protection and error/result contracts explicit.
- [x] Non-approval data contracts, schema changes and state transitions explicit.
- [x] Non-approval authorization/RLS matrices and positive/negative tests explicit.
- [x] Acceptance criteria, test matrix and milestone prerequisites written.
- [x] O-01 answered and dependent admin flow/lifecycle/fields/permissions/tests finalized.
- [x] Final cross-document review confirms no unresolved required behavior.
- [x] Complete specification committed/pushed and CI verified.

**Freeze confirmed.** Specification commit `9c5b7330ac0af49ce316c6631f1dcbc0902e650b`
verified green in CI:
https://github.com/EngCrafters/engsoc-platform/actions/runs/34987629797.
See the acceptance/delivery completion evidence ledger and ADR 0008 for the
recorded evidence. M1 (environment and migration rehearsal) may now begin.
