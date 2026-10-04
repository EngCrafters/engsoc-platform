# Admin events

This server-side data-access layer powers UC-02 M6 event management. It
returns minimal event DTOs, invokes only fixed `private.*` routines through
the restricted `app_runtime` database role, and never returns registration
identity from the list path.

`listAdminEvents` calls `private.list_admin_events`, which rechecks the active
administrative access level, applies the requested lifecycle and committee filter
in PostgreSQL, uses a `(event_date, id)` cursor, and computes only confirmed
and waitlisted totals. `getAdminEvent` calls `private.get_admin_event`, which
applies the same grant predicate, so an event visible in the list always opens
in the detail view; a malformed, missing or out-of-scope id returns `null` (404)
and a malformed id never reaches the database.
