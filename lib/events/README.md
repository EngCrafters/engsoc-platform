# events

Domain module for the `events` table (`db/schema.ts`). Owns everything about
reading published events for the public site; creating/publishing them is
the admin dashboard scope described in CLAUDE.md, not built yet.

Reads go through the narrow `private.list_public_events` /
`private.get_public_event` routines (`db/migrations/0007_uc02_public_event_reads.sql`),
called over the restricted `app_runtime` connection (`db/index.ts`) — the
same trusted-server-boundary pattern as `lib/registrations`. These routines
derive `availability` ("open" | "waitlist" | "closed") from status, capacity,
confirmed count and pending waitlist rows server-side, so the public surface
never receives raw status, capacity, counts, or committee IDs.

Exports `getPublicEventPage({ period, cursor })` (cursor-paginated
upcoming/past discovery, 20 per page) and `getPublicEvent(eventId)` (single
event, or `null` for anything not visible — draft, archived, or a malformed
ID all resolve the same way, so `app/(marketing)/events/[id]/page.tsx` can
call `notFound()` uniformly). Cursors are opaque base64url-encoded
`{v, period, date, id}` objects, validated on decode; an invalid or
mismatched-period cursor is treated as no cursor, not an error.

Import from `./index.ts` only. `./db.ts` (queries), `./types.ts` (shapes) and
`./format.ts` (Asia/Muscat date formatting, D01) are implementation details
and shouldn't be imported directly from outside `lib/events/`.
