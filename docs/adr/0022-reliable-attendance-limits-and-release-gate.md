# ADR 0022: Reliable attendance, fair limits and a release gate

Accepted for local implementation by the owner's October 21, 2026 repair request, which follows
the system audit of the same day. It amends ADR 0020 where stated. Migration
`0030_attendance_reliability_and_limits` is forward-only and unapplied to hosted environments;
applying it, like 0027–0029, needs the owner's approval.

## Check-in codes (amends ADR 0020)

The audit reproduced three failures of 0028's single stored challenge. Each open dashboard tab
replaced it every 75 seconds, so screens invalidated each other. A code a member had already
scanned stopped working at the next rotation. A printed or downloaded code expired after two
minutes.

Now each open session holds one random 32-byte secret. The code for a minute is
`sha256(secret || ':' || minute)`, derived inside the database. Every organizer screen therefore
shows the same code, and opening or reloading a screen writes nothing. A code is accepted during
its minute and the two after it, three minutes from first display. Codes from the last half hour
are reported as expired; anything else is invalid.

The secret never leaves the database: routines return only the current code and when to fetch
the next one. "Issue new code" replaces the secret and revokes every outstanding code. Opening an
already-open session only changes its closing time, so codes on screen stay valid. Only opening,
re-issuing and closing are audited.

Downloaded and printed QR codes open the attendance page, where members can sign in ahead of
time. They never carry a code and cannot record attendance by themselves. A relayed photo of the
live code still works during its three minutes; that limitation of ADR 0020 stands.

## Guest registrations and verified members (amends ADR 0020)

ADR 0020 never linked guest rows by email. In practice, a member who had registered as a guest
could neither register as a member nor check in, and all five existing staging registrations are
guest rows.

A guest registration is now linked to a member only when the member's Supabase Auth email is
confirmed and is exactly the attendee email. Proving the address proves that the registration
was made for that person. Linking sets `member_id` only: the seat, status, timestamps and FIFO
position are unchanged, and it is audited as `registration.member_linked` with
`via: confirmed_email`. It happens when the member opens the event, registers, or checks in.

An unconfirmed address, a typed email or another account never links anything. Nothing is merged
across events or accounts.

## Organizer-assisted attendance

A scoped organizer (the event committee's manager, or Board or Technical) can record or undo
attendance for a confirmed registration. This covers guests without an account, members without
a phone, and failed scans.

Reasons come from a fixed list, so audit rows carry no free text:

- check-in: `qr_unavailable`, `no_account`, `organizer_verified`;
- undo: `recorded_in_error`, `not_present`.

Waitlisted registrations are refused, and so is an organizer's own registration. Each change is
audited as `attendance.manual_confirmed` or `attendance.manual_reverted`.
`registrations.checkin_method` records `qr` or `manual`. The attendance list is alphabetical, with
offset pages, the method and whether the row has a member account.

## Rate limits

A per-address limit cannot tell a campus or carrier network from one abuser. Signed-in member
registration is therefore limited per member: 10 attempts in 10 minutes, in
`private.member_registration_attempts`.

Anonymous limits stay per address, with room for shared networks:

- guest registrations: 20 per address per 10 minutes (was 5);
- membership applications: 20 per address per hour (was 5).

The limits are one-line SQL functions. Attempts older than an hour are purged by whichever
registration takes the purge lock, as UC-02 data design section 5 intended; this keeps no IP
address beyond an hour.

## Release gate and diagnostics

`private.core_schema_version()` returns the newest migration applied, and every migration from
0030 on must redefine it; a test enforces this. On Vercel, `npm run build` first runs
`scripts/check-schema-compat.mjs` against `APP_RUNTIME_DATABASE_URL`. It refuses a production
build when:

- the database is older than the code's newest migration;
- the database cannot be reached;
- the runtime role bypasses row-level security (it must be `app_runtime`).

Preview builds warn, and local and CI builds skip the check. `GET /v1/health` answers `ok` or
`schema-behind` without disclosing versions. Member API and attendance failures are logged with
the error class and SQLSTATE only, never the message, and a missing routine is flagged as a schema
mismatch.

## Website

- **Headers.** Every page sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`, `nosniff`, a
  Referrer-Policy, a Permissions-Policy and `base-uri`/`object-src`/`form-action` limits. The full
  content policy is sent report-only until browser verification on staging allows enforcing it.
- **Cover caching.** Event cover images with a versioned URL may be shared by the CDN for five
  minutes, short enough for Core's visibility check to decide soon after archiving.
- **Projects stay uncached.** Project lists and images keep ADR 0021's no-store reads: caching
  them would delay "unpublish removes public visibility immediately", an owner decision. Trading
  immediacy for caching needs the owner's decision.
