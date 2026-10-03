# Admin UI

These components compose the protected UC-02 committee workspace: shell,
event list, filters, pagination, counts, lifecycle controls, scoped
registration operations, and resilient loading/error/empty states. Attendee
data appears only on the event registration screens.

The shell follows shadcn's dashboard-01 layout (inset sidebar, header with
breadcrumb, `AdminPageHeader` on every page); the Settings dialog follows
sidebar-13. Lists are tables, filters are tabs, and statuses stay monochrome.

Motion is limited to short feedback and spatial transitions.
`AdminPreferencesProvider` (`preferences.tsx`) honors the user's reduced-motion
preference and stores Settings > Appearance density/motion choices in this
browser's localStorage only.

`account-sections.tsx` (the `/admin/account` tabs and the Settings dialog) shows
identity, active committee scope, permissions, password recovery, and sign-out. `NoAccessState`
explains missing committee access and offers sign-out. Neither exposes
grant/revoke or other maintenance controls; the shell always labels the user
"Committee manager", never "Owner".
