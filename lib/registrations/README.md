# registrations

Domain module for the `registrations` table (`db/schema.ts`). Owns everything
about registering for an event, including the no-member-profile-yet case
(`memberId` nullable, `attendeeName`/`attendeeEmail` required — see CLAUDE.md,
"Current build decision").

Not implemented yet — this base commit only sets up the folder shape. UC-02
(event announcement + registration) is the use case that fills this in.

Import from `./index.ts` only. `./db.ts` (queries) and `./types.ts` (shapes)
are implementation details of this module and shouldn't be imported directly
from outside `lib/registrations/`.
