# registrations

Implementation status: M3 routes registration through the fixed
`private.register_for_event` routine over the restricted `app_runtime`
connection. The routine owns the event lock, duplicate uniqueness, capacity,
waitlist, event-start closure, audit write, and transaction-scoped IP limit.
This module only performs transport-safe validation and maps the routine's
stable result codes to the public domain result.

Domain module for the `registrations` table (`db/schema.ts`). Owns everything
about registering for an event, including the no-member-profile-yet case
(`memberId` nullable, `attendeeName`/`attendeeEmail` required — see CLAUDE.md,
"Current build decision").

Exports one function: `registerForEvent(input)`. It validates the input,
applies the rate limit described in `docs/adr/0005-registration-rate-limiting.md`
(more than 5 attempts from one IP in 10 minutes gets rejected), checks the
event is actually open for registration (UC-02's "Approval required" and
"Event full" exception flows), then writes the `registrations` row.

This function takes plain data in (`eventId`, `attendeeName`, `attendeeEmail`,
`intent`, `ipAddress`) and returns a plain result — no `FormData`, no
`headers()`, no framework code. `app/(marketing)/actions.ts`'s Server Action
is a thin wrapper that adapts a form submission into this shape.

Import from `./index.ts` only. `./db.ts` (queries) and `./types.ts` (shapes)
are implementation details of this module and shouldn't be imported directly
from outside `lib/registrations/`.
