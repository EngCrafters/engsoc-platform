# admin registrations

M7's private manager registration boundary. `server.ts` calls only the fixed
`private.list_admin_registrations`, `count_admin_registrations`,
`promote_waitlist`, and `export_admin_registrations` routines through the
restricted `app_runtime` connection. Every routine rechecks the manager's
active committee grant against the event. The UI intentionally exposes only
name, email, phone, status, and registration time; member linkage and attendance
are outside UC-02.

The phone is returned by the same routine call and the same row as everything
else — there is no per-registration lookup and no second query. It is private
attendee information in exactly the sense email is, so it travels only on these
authorized, committee-scoped paths: it is never in a public DTO, and `lib/events`
has no field for it.

A registration captured before migration 0024 has a null phone. The list shows
"Not captured" for it and the CSV exports an empty cell — the honest answer in
both places, and never a placeholder word or an invented number. The CSV value
goes through the same formula-prefix neutralization as every other cell: an
international number starts with `+`, which is a spreadsheet formula prefix, so
it is deliberately not special-cased.

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
