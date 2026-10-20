# ADR 0020: Event media, member registration and attendance

Accepted October 20, 2026 by the owner's complete Event Management handoff.
This extends the frozen UC-02 contract and ER addendum. Existing access, review,
capacity, FIFO waitlist, guest registration and identity rules remain. Work stays
on the existing local feature branches; no push or hosted migration is authorized.
The owner authorizes implementation choices in this extension.

Events gain nullable `cover_image_key` and `phone_required` (false by default).
Members gain nullable private `phone`; guest registrations gain nullable private
`attendee_phone`. Existing registration `member_id`, `attended`, and
`checked_in_at` are reused. No duplicate attendance entity or account is created.
Settings follow existing event revision/review rules, extending editable fields.

One private `event_checkin_sessions` row belongs to each event, created lazily.
A missing session means closed. It stores an open flag, closing timestamp,
SHA-256 challenge hash and expiry. Opening/rotation generates 32 random bytes
server-side; challenges expire after two minutes and are revoked on closure.
The live manager display refreshes before expiry. A stable attendance-page QR
is always available, including for drafts. Live display/download/print includes
the short-lived challenge in the URL fragment. It is public proof of access to
the current display, never privileged authority. A photograph can still be
relayed during its lifetime; this does not prove physical location. Organizers
operate the window and can revoke immediately.

Core verifies Supabase tokens through the existing member identity boundary.
Member operations require confirmed email and an existing Member, dependent on
0027 activation; no fallback identity/activation path is introduced. Profile
reads/phone updates concern only the verified actor. Core supplies name/email,
never request fields. Member registration delegates to the canonical seat routine,
retaining its limiter, locks, uniqueness, capacity and waitlist rules. Existing
unverified guest rows are never claimed by email matching. Guests can still
register, supplying a validated phone if the event requires one.

Check-in requires explicit POST, a confirmed registration linked to that member,
correct event/challenge, an unexpired organizer window, and a published,
unarchived event. The event lock serializes registration, window changes and
check-in. Repeated confirmation returns the original timestamp without another
write/audit. Waitlisted, unlinked guest, foreign-member and superseded rows cannot
check in. Session changes/attendance are audited without phones/raw challenges.

Managers use live committee scope; Board/Technical retain global scope. Private
reads/writes use fixed SECURITY DEFINER routines owned by the existing NOLOGIN
executor; runtime gets execution only. Sessions have forced RLS, no browser
grants. Public projections expose image URLs and phone requirements, never
keys, phones, attendees or sessions. Attendance lists are event-scoped, paged,
searchable/filterable. CSV is a bounded scoped snapshot with formula escaping,
no-store and same-origin POST.

Covers reuse server-only Supabase S3 signing with a separate private event
bucket. Authorized managers upload JPEG/PNG only; images are decoded/re-encoded
to remove metadata, bounded to 3 MiB input and 20 megapixels. Random object names
replace supplied filenames. Failed saves clean up known uncommitted uploads;
replaced objects are deleted after successful persistence. Public images use
a visibility-checked Core route, never a public membership bucket.

Descriptions remain text with HTTP(S) auto-links and `[label](https://...)`.
React renders text/anchors without evaluating HTML. Cards shorten plain summaries;
full descriptions preserve complete tokens and line breaks.

Freeze checklist: scope, data, authorization, privacy, lifecycle and testing
choices above are accepted under the owner's explicit engineering discretion.
Verification: disposable PostgreSQL replay, runtime/anon/authenticated denials,
registration/check-in races and lifecycle, API auth/validation, both repositories'
lint/types/tests/build, and local browser checks. No hosted test mutations.

Read-only staging inspection on October 20 found 0026's submission routine but
no `private.get_my_membership(uuid)` from 0027. The configured runtime URL logs
in as `postgres`; deployment must use documented restricted `app_runtime`.
Neither configuration nor hosted data was changed by this inspection.
