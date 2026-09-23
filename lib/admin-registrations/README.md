# admin registrations

M7's private manager registration boundary. `server.ts` calls only the fixed
`private.list_admin_registrations`, `count_admin_registrations`,
`promote_waitlist`, and `export_admin_registrations` routines through the
restricted `app_runtime` connection. Every routine rechecks the manager's
active committee grant against the event. The UI intentionally exposes only
name, email, status, and registration time; member linkage and attendance are
outside UC-02.

The export route is a same-origin POST, creates an audited event-scoped
snapshot, emits UTF-8 BOM CSV with formula-prefix neutralization, and returns
private/no-store content. It never exposes internal IDs, Member data, IPs, or
attendance fields.
