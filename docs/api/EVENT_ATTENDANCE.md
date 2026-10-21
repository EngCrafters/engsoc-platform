# Event extension (ADR 0020, amended by ADR 0022)

Requires approved rollout of 0027, 0028, 0029 and 0030 (see `../STAGING_ROLLOUT_0027_0030.md`).
No hosted migrations were applied during implementation. Use the restricted `app_runtime` database URL.

Public event DTOs add `coverImageUrl` (nullable, relative to Core's origin) and
`phoneRequired` (boolean). Existing fields/cursors/capacity semantics remain.
`GET /v1/events/{id}/image` serves sanitized JPEG/PNG only for public events.
Guest `POST /v1/events/{id}/registrations` additionally accepts `attendeePhone`
when required; name/email remain unverified guest identity.

Member routes use the existing Supabase JWT as Bearer, exact-origin CORS,
credentials omitted, JSON bodies, and no-store responses. No API client key
or identity fields are accepted. Existing membership activation stays in 0027.

| Route                                   | Input / success data                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET `/v1/me/profile`                    | Own `{code,name,email,phone}`                                                                                           |
| PATCH `/v1/me/profile`                  | `{phone}` international E.164; returns own profile                                                                      |
| POST `/v1/me/events/{id}/registrations` | `{intent: register or join_waitlist}`; existing 201 `{data:{status}}`; limited per member, no client address needed     |
| GET `/v1/me/events/{id}/attendance`     | `{data:{code,profile,registration,checkinOpen,closesAt}}`; registration nullable, otherwise status/attended/checkedInAt |
| POST `/v1/me/events/{id}/attendance`    | `{challenge}`: the live code (64 hex characters); `{data:{code,checkedInAt,alreadyAttended}}`                           |

Profile/attendance success `code` is `SUCCESS`. Expected failures retain RFC
9457 status/code and use `errors[0].code`: MEMBER_REQUIRED/EMAIL_UNCONFIRMED (403),
PHONE_REQUIRED (422), NOT_REGISTERED/WAITLISTED/CHECKIN_CLOSED/CHALLENGE_EXPIRED/
INVALID_CHALLENGE (409). Existing registration conflict reasons and 429
Retry-After remain. Invalid tokens are 401; unavailable dependencies are 503.
Idempotent attendance retries return the original timestamp with no second audit.

Managers open `/admin/events/{id}/attendance` from the event details. Controls
and participant data use server actions with fresh auth and database scope checks.
Opening stores one random secret; the database derives each minute's code from
it, so every organizer screen shows the same code and opening a screen changes
nothing. A code is accepted for three minutes from first display. "Issue new
code" replaces the secret and revokes all outstanding codes; closing revokes it
too. Downloaded/printed QR codes open the attendance page only (members can sign
in early) and never carry a code. Window maximum is 12 hours. The code fragment
is removed on scan and kept in the tab for at most three minutes for the login
return. No attendance is recorded on GET/navigation.

A guest registration whose email equals the signed-in member's confirmed Supabase
email becomes that member's (audited) when they open, register for or check in to
the event. Organizers can record or undo attendance for a confirmed registration
with a fixed reason (`qr_unavailable`, `no_account`, `organizer_verified`;
undo: `recorded_in_error`, `not_present`); never their own, never a waitlisted one.
The list is alphabetical and shows QR or manual check-in; the CSV adds a Method
column.

CSV is an event-scoped, bounded snapshot (10,000 rows / 10 MiB), filtered by
status/search, formula-escaped, private/no-store and protected by the existing
same-origin POST guard. Phones do not appear in this export.

Rollout after approval: verify backup/target; apply 0027–0030 in order;
provision a separate private event Storage bucket and set
`SUPABASE_S3_EVENT_BUCKET`; set `PUBLIC_WEBSITE_ORIGIN` to the matching website;
verify Core/website share the same Supabase Auth project and allowed origins;
run synthetic staging flows, then review before any production rollout.
