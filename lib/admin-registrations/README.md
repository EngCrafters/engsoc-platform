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

`lib/security/request-origin.ts` validates the POST's exact Origin against
server-only `APP_ORIGIN` (production: `https://engsoc-platform.vercel.app`).
Missing, opaque (`null`), malformed and foreign origins fail closed; a present
Referer must also match. Host/proxy headers and Auth redirect configuration do
not establish trust. Unconfigured development accepts loopback origins only.
The registration page uses `same-origin` referrer metadata so native form POSTs
send an identifiable Origin without sending a Referer cross-site. Root metadata
restores `no-referrer` on other pages, including client-side navigation.
