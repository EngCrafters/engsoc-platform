# events

Domain module for the `events` table (`db/schema.ts`). Owns everything about
an event: creating, publishing, and reading them.

Currently exports one function: `getPublishedEvents()`, UC-02's "event
appears live on the public events page" step. It returns the
`PublishedEvent` shape (`./types.ts`) — deliberately narrower than the raw
`events` row, since a visitor shouldn't see internal fields like
`committeeId`.

`app/(marketing)/page.tsx` calls this directly as a Server Component import,
not through a fetch() or API route — that's the point of both living in the
same app. Creating and publishing events (the committee-facing side) isn't
built yet; that's the admin dashboard scope described in CLAUDE.md.

Import from `./index.ts` only. `./db.ts` (queries) and `./types.ts` (shapes)
are implementation details of this module and shouldn't be imported directly
from outside `lib/events/`.
