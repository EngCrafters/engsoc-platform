# events

Implementation status: M3 reads the public event projection with the Supabase
anon key, so RLS and column grants remain active on server-rendered pages.
The existing published-only query is still partial.
The target public/full/past lifecycle, pagination and admin rules live in
`docs/UC-02_Deep_Dive.md` and its companions. Follow their specification gate
before changing this module; the README below describes current code only.

Domain module for the `events` table (`db/schema.ts`). Owns everything about
an event: creating, publishing, and reading them.

Currently exports `getPublishedEvents()` and `getPublishedEvent()`, the UC-02
public discovery/detail reads. They return the
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
