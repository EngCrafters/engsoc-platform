# Admin UI

These components compose the protected UC-02 M6 committee workspace: shell,
event list, filters, pagination, counts, lifecycle controls, and resilient
loading/error/empty states. They receive only safe event DTOs; attendee data
is intentionally absent until M7.

Motion is limited to short feedback and spatial transitions. `AdminMotionConfig`
honors the user’s reduced-motion preference.

`AccountOverview` (`/admin/account`) and `NoAccessState` are read-only,
presentational, and take only the signed-in email, user id and active committee
names. They expose no grant/revoke or other maintenance controls; the shell
always labels the user "Committee manager", never "Owner".
