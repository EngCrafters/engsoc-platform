# registrations

Implementation status: as of M2, the database itself enforces one active
registration per (event, email) via a partial unique index — this module
surfaces that as `already_registered` rather than crashing — but this code
still writes directly to `registrations` over the privileged DATABASE_URL
connection, not through the M2 `private.register_for_event` routine. It
still doesn't enforce capacity concurrency or event-start closure, and has
no waitlist. `docs/UC-02_Deep_Dive.md` and its companions specify the
target; M3 ("public server boundary") replaces this direct-write path with
the routine. The behavior below describes existing code, not UC-02
completion.

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
`ipAddress`) and returns a plain result — no `FormData`, no `headers()`, no
framework code. `app/(marketing)/actions.ts`'s Server Action is a thin
wrapper that adapts a form submission into this shape; the actual rules live
here, not in the action.

Import from `./index.ts` only. `./db.ts` (queries) and `./types.ts` (shapes)
are implementation details of this module and shouldn't be imported directly
from outside `lib/registrations/`.
