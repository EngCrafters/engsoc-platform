# registrations

Implementation status: M3 routes registration through the fixed
`private.register_for_event` routine over the restricted `app_runtime`
connection. The routine owns the event lock, duplicate uniqueness, capacity,
waitlist, event-start closure, audit write, and transaction-scoped IP limit.
This module only performs transport-safe validation and maps the routine's
stable result codes to the public domain result.

Domain module for the `registrations` table (`db/schema.ts`). Owns everything
about registering for an event, including the no-member-profile-yet case
(`memberId` nullable, `attendeeName`/`attendeeEmail`/`attendeePhone` required for
new registrations — see CLAUDE.md, "Current build decision").

## Registration identity

A registration captures three things about who is attending: **name, email and
phone**. Email is the identity and the deduplication key — one active
registration per event and normalized email (`docs/adr/0004`,
`docs/UC-02_Data_and_Security.md` section 3). Phone is contact detail, not an
identity: it is not unique, nothing searches by it, and it is not indexed.

`attendeePhone` is required for every NEW registration and nullable on the
column, because every registration captured before migration 0024 has none and
must stay valid. A historical NULL is never filled in with a guess.

Phone is private attendee information, exactly like email. It is never returned
on a public path: `lib/events` does not know about it, and no public DTO has a
field for it. It leaves the server only through the committee-scoped
`lib/admin-registrations` routines, and only for an authorized actor.

## Phone normalization

One rule, defined once in `phone.ts` and mirrored in SQL by
`private.normalize_phone` plus the `registrations_phone_canonical` CHECK:

1. Arabic-Indic and Eastern Arabic-Indic digits become ASCII.
2. A letter or a control character makes the value invalid. They are refused,
   not stripped — reading "call me on 968..." as a number would be worse than
   saying no.
3. Everything else that is not a digit or a plus is presentation formatting and
   is dropped, so a person can type the number the way they write it.
4. What remains must be an optional leading `+` followed by 7 to 15 digits.

Stored as text, never numeric: a phone number is an identifier, so a leading
zero and a leading `+` both have to survive. There is no phone-number
dependency; the rule is small enough to own.

Both layers enforce it. The database is authoritative — a caller that skips
`lib/registrations` still cannot store a malformed number, and
`private.register_for_event` returns `INVALID_PHONE` for a missing or invalid
one. This layer exists so the visitor gets a precise, translated message
instead of a generic failure.

Exports one function: `registerForEvent(input)`. It validates the input,
applies the rate limit described in `docs/adr/0005-registration-rate-limiting.md`
(more than 5 attempts from one IP in 10 minutes gets rejected), checks the
event is actually open for registration (UC-02's "Approval required" and
"Event full" exception flows), then writes the `registrations` row.

This function takes plain data in (`eventId`, `attendeeName`, `attendeeEmail`,
`attendeePhone`, `intent`, `ipAddress`) and returns a plain result — no `FormData`, no
`headers()`, no framework code. `app/(marketing)/actions.ts`'s Server Action
is a thin wrapper that adapts a form submission into this shape.

Import from `./index.ts` only. `./db.ts` (queries) and `./types.ts` (shapes)
are implementation details of this module and shouldn't be imported directly
from outside `lib/registrations/`.
