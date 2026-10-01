# Admin UI

These components compose the protected UC-02 committee workspace: shell,
event list, filters, pagination, counts, lifecycle controls, scoped
registration operations, and resilient loading/error/empty states. Attendee
data appears only on the event registration screens.

Motion is limited to short feedback and spatial transitions. `AdminMotionConfig`
honors the user’s reduced-motion preference.

`AccountOverview` (`/admin/account` and the Settings dialog) shows identity,
active committee scope, password recovery, and sign-out. `NoAccessState`
explains missing committee access and offers sign-out. Neither exposes
grant/revoke or other maintenance controls; the shell always labels the user
"Committee manager", never "Owner".
