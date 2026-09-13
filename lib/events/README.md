# events

Domain module for the `events` table (`db/schema.ts`). Owns everything about
an event: creating, publishing, and reading them.

Not implemented yet — this base commit only sets up the folder shape. UC-02
(event announcement + registration) is the use case that fills this in.

Import from `./index.ts` only. `./db.ts` (queries) and `./types.ts` (shapes)
are implementation details of this module and shouldn't be imported directly
from outside `lib/events/`.
