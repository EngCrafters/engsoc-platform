# API reference

Every HTTP endpoint implemented in this repository at the commit in
[docs/README.md](../README.md#version-documented): the public `/v1` API, the Auth callback and the
dashboard's route handlers. Dashboard pages and server actions are listed in
[Dashboard](dashboard.md). There are **no webhooks and no scheduled jobs**.

The machine-readable contract is [`docs/api/openapi.v1.yaml`](../api/openapi.v1.yaml). It does
not cover the project endpoints and has other gaps, listed at the [end](#openapi-inconsistencies).
Examples below use fictional values.

## Conventions shared by `/v1`

### Base URLs

| Environment              | Base                                                 | Evidence                                               |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| Production               | `https://api.essqu.com/v1`                           | **Deployed** (2026-10-24: `GET /v1/health` → 200 `ok`) |
| Production, Vercel alias | `https://engsoc-platform.vercel.app/v1`              | Listed in OpenAPI as "pre-domain production"           |
| Local                    | `http://127.0.0.1:3000/v1` (default `next dev` port) | **Source**                                             |

The host policy that would restrict `api.essqu.com` to `/v1` and `admin.essqu.com` to the
dashboard ([`lib/api/host-policy.ts`](../../lib/api/host-policy.ts)) is **dormant** unless
`CORE_API_HOST_ENFORCEMENT=true`. **Deployed** (2026-10-24): `https://api.essqu.com/admin/login`
serves the dashboard login, so enforcement is off in production.

### Request identity

Every response carries `x-request-id`. A caller-supplied `X-Request-Id` of 8–128 characters from
`A–Z a–z 0–9 . _ -` is echoed. Anything else is replaced with a UUID
([`lib/api/http.ts`](../../lib/api/http.ts), `requestIdFrom`).

### Errors

Failures are RFC 9457 documents with `content-type: application/problem+json`, `cache-control:
no-store` and the public vocabulary in [`lib/api/problems.ts`](../../lib/api/problems.ts):

```json
{
  "type": "https://api.essqu.com/problems/conflict",
  "title": "Conflict",
  "status": 409,
  "code": "conflict",
  "requestId": "3f1c2b8e-0d5a-4c1e-9a77-1b2c3d4e5f60",
  "reason": "event-full"
}
```

| `code`                   | Status | Typical cause                                                             |
| ------------------------ | ------ | ------------------------------------------------------------------------- |
| `bad-request`            | 400    | Body not an object, malformed JSON or multipart                           |
| `unsupported-media-type` | 415    | Wrong `Content-Type`                                                      |
| `payload-too-large`      | 413    | Body over the route's limit                                               |
| `invalid-fields`         | 422    | Validation failure; `errors: [{field, code}]`                             |
| `unauthorized`           | 401    | Missing or invalid credential; adds `WWW-Authenticate: Bearer`            |
| `forbidden`              | 403    | Disallowed `Origin`, missing scope, not a member, feature switched off    |
| `not-found`              | 404    | Unknown, private, or malformed ID                                         |
| `conflict`               | 409    | Domain state conflict; registration and membership conflicts add `reason` |
| `rate-limited`           | 429    | Database rate limit; adds `Retry-After`                                   |
| `service-unavailable`    | 503    | Database, Auth, storage or client-IP unavailable                          |

Public `reason` values:

- registration: `already-registered`, `already-waitlisted`, `event-full`, `registration-closed`,
  `registration-available`;
- membership: `already-applied`, `already-member`.

**Member and project routes** report the precise domain result in `errors[0].code`
([`lib/event-management/api.ts`](../../lib/event-management/api.ts) `memberResult`;
[`lib/projects/api.ts`](../../lib/projects/api.ts) `projectResult`):

| Domain code                                                                                                                                                                                                                                                                                                                                        | Status                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `SUCCESS`                                                                                                                                                                                                                                                                                                                                          | 200 (or the route's success status) |
| `NOT_FOUND`, `EVENT_NOT_FOUND`                                                                                                                                                                                                                                                                                                                     | 404                                 |
| `MEMBER_REQUIRED`, `EMAIL_UNCONFIRMED`; projects also `FORBIDDEN`, `SELF_REVIEW`                                                                                                                                                                                                                                                                   | 403                                 |
| `PHONE_REQUIRED` (field `phone`), `VALIDATION_ERROR`                                                                                                                                                                                                                                                                                               | 422                                 |
| `RATE_LIMITED`                                                                                                                                                                                                                                                                                                                                     | 429, `Retry-After: 600`             |
| `NOT_REGISTERED`, `WAITLISTED`, `CHECKIN_CLOSED`, `CHALLENGE_EXPIRED`, `INVALID_CHALLENGE`, `ALREADY_REGISTERED`, `ALREADY_WAITLISTED`, `EVENT_FULL`, `REGISTRATION_CLOSED`, `REGISTRATION_AVAILABLE`, `ALREADY_PENDING`, `UNCHANGED`, `CONFLICT`; projects `STALE_REVISION`, `INVALID_TRANSITION`, `MEDIA_LIMIT`, `MEDIA_IN_USE`, `PROJECT_LIMIT` | 409                                 |
| anything else                                                                                                                                                                                                                                                                                                                                      | 503                                 |

### Authentication types

| Type                    | Used by                                                          | Verification                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API client key**      | `GET /events`, `GET /events/{id}`                                | `Authorization: Bearer essq_live_<prefix>_<secret>` (production) or `essq_test_…` (staging). [`lib/api/auth.ts`](../../lib/api/auth.ts) hashes the token (SHA-256) and calls `private.verify_api_client(prefix, hash, scope, environment)`, which checks active, not revoked, not expired, environment and scope. 401 for any invalid key; 403 for a valid key without `events:read`; 503 if the registry is unreachable. |
| **Member access token** | `/me/*`, own project images                                      | `Authorization: Bearer <Supabase access token>`. [`lib/auth/member.ts`](../../lib/auth/member.ts) checks the JWT shape and asks Supabase Auth (`auth.getUser`) with the public anon key. 401 when Supabase rejects the token; 503 when Supabase is unreachable or `NEXT_PUBLIC_SUPABASE_*` is unset. The actor is always the verified user ID, never a request field (ADR 0015).                                          |
| **Anonymous**           | Registration, membership, health, public images, public projects | none                                                                                                                                                                                                                                                                                                                                                                                                                      |

Being authenticated never implies membership or administrative access. Each routine checks the
database state for the actor.

### CORS

CORS uses exact-origin matching ([`lib/api/cors.ts`](../../lib/api/cors.ts)):

- Allowed origins come from `CORE_API_ALLOWED_ORIGINS` (comma-separated). When it is unset, the
  defaults are `https://essqu.com` and `https://www.essqu.com`.
- A request whose `Origin` header is present but not allowed gets **403 `forbidden`** before any
  work, on routes that check origin.
- A preflight from a disallowed origin gets 204 without allow headers.
- Responses always send `Vary: Origin`, never allow credentials, expose `X-Request-Id` and
  `Retry-After`, and cache preflights for 600 seconds.
- Requests without `Origin` (server-to-server) are not affected.

Allowed methods and headers by route group:

| Route group                 | Methods                             | Headers                                     |
| --------------------------- | ----------------------------------- | ------------------------------------------- |
| Registration and membership | `POST, OPTIONS`                     | `Content-Type, X-Request-Id`                |
| `/me/membership`            | `GET, OPTIONS`                      | `Authorization, X-Request-Id`               |
| Other `/me/*` member routes | `GET, POST, PATCH, OPTIONS`         | `Authorization, Content-Type, X-Request-Id` |
| `/me/profile/photo`         | `GET, PUT, DELETE, OPTIONS`         | same                                        |
| Project routes              | `GET, POST, PATCH, DELETE, OPTIONS` | same                                        |

### Body limits and caching

- **Body limits.** JSON 16 KiB (`readJsonBody`); project writes 64 KiB; multipart 4,500,000 bytes;
  raw image uploads 3 MiB. `Content-Length` is checked first and the stream is also counted.
- **Caching.** Event reads send `public, s-maxage=30, stale-while-revalidate=120`. Everything
  personal or written sends `no-store` (or `private, no-store`).

## Endpoint summary

| Method and path                                | Auth                 | Purpose                                     |
| ---------------------------------------------- | -------------------- | ------------------------------------------- |
| `GET /v1/health`                               | none                 | Database reachable and schema compatible    |
| `GET /v1/events`                               | API key              | Published events, paginated                 |
| `GET /v1/events/{eventId}`                     | API key              | One published event                         |
| `GET /v1/events/{eventId}/image`               | none                 | Cover image of a public event               |
| `POST /v1/events/{eventId}/registrations`      | none                 | Guest registration                          |
| `POST /v1/membership-applications`             | none                 | Membership application with ID card         |
| `POST /v1/membership-applications/status`      | status token (body)  | Applicant's own status                      |
| `GET /v1/me/membership`                        | member token         | Own membership and application              |
| `GET /v1/me/profile`                           | member token         | Own profile and feature switches            |
| `PATCH /v1/me/profile`                         | member token         | Save the phone, or the editable fields      |
| `GET`, `PUT`, `DELETE /v1/me/profile/photo`    | member token         | Own photo                                   |
| `POST /v1/me/profile/changes`                  | member token         | Request a name or student ID correction     |
| `GET /v1/me/events`                            | member token         | Own registrations                           |
| `POST /v1/me/events/{eventId}/registrations`   | member token         | Member registration                         |
| `GET /v1/me/events/{eventId}/attendance`       | member token         | Check-in state for one event                |
| `POST /v1/me/events/{eventId}/attendance`      | member token         | Confirm attendance with the live code       |
| `GET /v1/projects`                             | none                 | Published projects, 30 per page             |
| `GET /v1/projects/{id}`                        | none                 | One published project                       |
| `GET /v1/projects/{id}/media/{media}`          | none or member token | Project image                               |
| `GET`, `POST /v1/me/projects`                  | member token         | Own projects; create                        |
| `GET`, `PATCH /v1/me/projects/{id}`            | member token         | Own project; save or submit                 |
| `POST /v1/me/projects/{id}/media`              | member token         | Upload a project image                      |
| `DELETE /v1/me/projects/{id}/media/{media}`    | member token         | Remove an unused image                      |
| `GET /auth/callback`                           | Auth email link      | Verifies Auth links for the dashboard       |
| `GET /admin/events/{id}/image`                 | dashboard session    | Cover preview for authorized administrators |
| `POST /admin/events/{id}/registrations/export` | dashboard session    | Registration CSV                            |
| `POST /admin/events/{id}/attendance/export`    | dashboard session    | Attendance CSV                              |
| `GET /admin/membership/{id}/document`          | dashboard session    | SQU ID card for a reviewer                  |
| `GET /admin/projects/{id}/media/{media}`       | dashboard session    | Project image for reviewers                 |

Every `/v1` route that a browser calls also answers `OPTIONS` (preflight). The public read routes
(`/health`, `/events/{id}/image`, `/projects`, `/projects/{id}`) do not check `Origin`.

---

## Health

### `GET /v1/health`

- **Location:** [`app/v1/health/route.ts`](../../app/v1/health/route.ts).
- **Auth:** none. No CORS headers.
- **Behaviour:** compares `private.core_schema_version()` with the highest migration index in
  `db/migrations/meta/_journal.json` (`REQUIRED_SCHEMA_VERSION`, currently 32). The version is 0
  before migration 0030.
- **Responses:**
  - `200 {"data":{"status":"ok"}}`;
  - `503 {"data":{"status":"schema-behind"}}` (logs `schema_behind` with both numbers);
  - `503` problem when the database is unreachable.

  Version numbers are never disclosed. `no-store`.

- **Side effects:** none.

## Events

### `GET /v1/events`

- **Location:** [`app/v1/events/route.ts`](../../app/v1/events/route.ts) → `lib/events`
  `getPublicEventPage` → `private.list_public_events` and `private.public_event_options`.
- **Auth:** API key with `events:read`. A disallowed `Origin` gets 403.
- **Query:**
  - `period`: `upcoming` (default; any other value is treated as `upcoming`) or `past`;
  - `cursor`: opaque. An invalid or foreign cursor is ignored, which returns the first page.
- **Pagination:** 20 events per page.
  - Upcoming: event date ascending, then ID.
  - Past: date descending.
  - `meta.nextCursor` is a base64url JSON `{v:1, period, date, id}`, or `null`.
- **Visibility:** status `published` or `full`, not archived. Upcoming means `event_date` after
  now.
- **Response 200:**

```json
{
  "data": [
    {
      "id": "8d0f6f1e-3c6b-4a59-9d2a-5f6e7a8b9c0d",
      "title": "Introduction to CAD",
      "description": "A hands-on workshop.",
      "eventDate": "2026-11-05T14:00:00.000Z",
      "location": "Engineering Building, Room 101",
      "committeeName": "Media Committee",
      "availability": "open",
      "coverImageUrl": "/v1/events/8d0f6f1e-3c6b-4a59-9d2a-5f6e7a8b9c0d/image?v=2b7c…e1.jpg",
      "phoneRequired": false
    }
  ],
  "meta": { "nextCursor": null }
}
```

`availability` comes from `private.public_event_availability`:

- `closed` once the event has started;
- `waitlist` when status is `full`, anyone is waitlisted, or confirmed registrations have reached
  capacity;
- `open` otherwise.

`coverImageUrl` is relative to Core's origin. The DTO field list is explicit in
[`lib/api/dto.ts`](../../lib/api/dto.ts).

- **Errors:** 401, 403, 503.
- **Cache:** `public, s-maxage=30, stale-while-revalidate=120`.

### `GET /v1/events/{eventId}`

Same auth and fields as the list (`{ data: Event }`). A malformed UUID, a draft, an archived event
and an unknown ID all return the same 404. Source:
[`app/v1/events/[eventId]/route.ts`](../../app/v1/events/[eventId]/route.ts).

### `GET /v1/events/{eventId}/image`

- **Location:** [`app/v1/events/[eventId]/image/route.ts`](../../app/v1/events/[eventId]/image/route.ts).
- **Auth:** none. The event must be public (`private.get_public_event`).
- **Behaviour:** reads `cover_image_key` and fetches the object from the event bucket. The `v`
  query parameter is ignored by the handler; it only makes the URL unique per cover.
- **Responses:** 200 with `image/jpeg` or `image/png`, `public, max-age=60, must-revalidate`,
  `content-security-policy: default-src 'none'`. 404 for an unknown or private event or no cover.
  503 on a storage or database failure.

### `POST /v1/events/{eventId}/registrations`

- **Location:** [`app/v1/events/[eventId]/registrations/route.ts`](../../app/v1/events/[eventId]/registrations/route.ts)
  → `lib/registrations` `registerForEvent` → `private.register_event_guest`.
- **Auth:** none. A disallowed `Origin` gets 403.
- **Body** (`application/json`, ≤ 16 KiB). Only these keys are accepted; any other key is 422
  `unexpected-field`:

```json
{
  "attendeeName": "Sample Student",
  "attendeeEmail": "student@example.test",
  "intent": "register",
  "attendeePhone": "+96890000000"
}
```

- **Validation:**
  - `attendeeName`: 1–200 characters after trimming, no control characters;
  - `attendeeEmail`: ≤ 254 characters, `x@y.z` shape, stored lower-cased;
  - `intent`: `register` (default) or `join_waitlist`;
  - `attendeePhone`: optional unless the event has `phone_required`; must match
    `^\+[1-9][0-9]{6,14}$`.
- **Rules** (database, in one transaction with row locks):
  - the event must be published or full and not archived, otherwise 404;
  - registration closes at the event's start time;
  - `register` succeeds only when the event is not full;
  - `join_waitlist` succeeds only when the event is full (status `full`, capacity reached, or a
    waitlist already exists);
  - a duplicate email for the same event returns 409.
- **Rate limit:** 20 attempts per client IP per 10 minutes (`private.guest_registration_limit`).
  The client IP comes only from Vercel's `x-vercel-forwarded-for`
  ([`lib/client-ip/server.ts`](../../lib/client-ip/server.ts)). Without a trustworthy IP the
  request gets 503.
- **Responses:**
  - `201 {"data":{"status":"confirmed"}}` or `{"data":{"status":"waitlisted"}}`;
  - 409 with a registration `reason`;
  - 422 (including `errors:[{field:"attendeePhone",code:"required"}]`);
  - 404;
  - 429 with `Retry-After: 600`;
  - 503.
- **Side effects:**
  - inserts `public.registrations` with the phone when given;
  - inserts an attempt row in `public.registration_attempts`;
  - writes an audit row (`registration.created` or `registration.waitlisted`).

  Not idempotent: a repeat returns 409.

## Membership applications

### `POST /v1/membership-applications`

- **Location:** [`app/v1/membership-applications/route.ts`](../../app/v1/membership-applications/route.ts)
  → [`lib/membership/index.ts`](../../lib/membership/index.ts) (`validateApplication`,
  `submitMembershipApplication`).
- **Auth:** none. A disallowed `Origin` gets 403.
- **Body:** `multipart/form-data` (≤ 4,500,000 bytes) with exactly these parts:
  - `fullName`, `email`, `universityId`, `academicYear`, `discipline`, `consent`,
    `consentVersion`: one text value each;
  - `interests`: zero to four repeated values;
  - `idDocument`: one file.

  Unknown parts get 422 `unexpected-field`. A repeated scalar or a file in a text field gets 422
  `invalid`.

- **Validation:**

| Field          | Rule                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullName`     | 1–200 characters, no control characters                                                                                                                                                                     |
| `email`        | ≤ 254 characters, an `squ.edu.om` address (subdomains allowed), stored lower-cased                                                                                                                          |
| `universityId` | 6–10 digits                                                                                                                                                                                                 |
| `academicYear` | `1`–`5`                                                                                                                                                                                                     |
| `discipline`   | `mechanical`, `electrical`, `civil`, `petroleum`, `chemical`, `mechatronics`, `industrial`                                                                                                                  |
| `interests`    | At most 4 distinct values from `cad`, `simulation`, `embedded`, `robotics`, `structures`, `process`, `data`, `programming`, `power`, `reservoir`, `quality`, `management`, `sustainability`, `hse`          |
| `consent`      | `true`; `consentVersion` must be `2026-10-v1`                                                                                                                                                               |
| `idDocument`   | 1 byte to 4 MiB. JPEG, PNG, WebP or PDF, identified by file signature. PDFs with active content (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction`, `/AA`, `/RichMedia`, `/XFA`) are refused. |

- **Rules** (`private.begin_membership_submission` and
  `private.submit_membership_application` or `private.submit_stored_membership_application`):
  - 20 submissions per IP per hour;
  - 409 `already-member` when a member has the email or student ID;
  - 409 `already-applied` when an application in `pending_review`, `verified` or `approved` has
    either.
- **Storage:** when the five `SUPABASE_S3_*` membership variables are set, the card is uploaded
  to the private membership bucket under `membership-id-cards/<uuid>.<ext>` before the
  application is written. A failed write queues the object for deletion. When none are set, the
  card is stored as `bytea` in `private.membership_documents`. A partial configuration refuses
  submissions with 503. See [Storage](storage.md).
- **Response 201:**
  `{"data":{"status":"pending_review","statusToken":"<43-character base64url token>"}}`. The token
  is shown once; Core stores only its SHA-256.
- **Errors:** 409 with `reason`, 413, 415, 422, `429 Retry-After: 3600`, 503.
- **Side effects:**
  - inserts `private.membership_applications` and `private.membership_documents`;
  - inserts `private.membership_submission_attempts`;
  - writes an audit row identified by application ID only.

### `POST /v1/membership-applications/status`

- **Body:** `{"statusToken":"<43-character token>"}` and nothing else.
- **Response 200:**
  `{"data":{"status":"pending_review|approved|rejected","submittedAt","decidedAt","activated"}}`.
  The internal `verified` stage is reported as `pending_review`.
- **Errors:** 404 unknown token, 422, 503.
- **Side effects:** none.
- **Location:** [`app/v1/membership-applications/status/route.ts`](../../app/v1/membership-applications/status/route.ts)
  → `private.get_membership_application_status`.

## Signed-in member routes

All require a member access token. They return 401 without a valid token and 403 for a
disallowed `Origin`.

### `GET /v1/me/membership`

- **Location:** [`app/v1/me/membership/route.ts`](../../app/v1/me/membership/route.ts) →
  `private.get_my_membership`.
- **Response 200:**
  - unconfirmed email: `{"data":{"emailConfirmed":false,"member":null,"application":null}}`;
  - otherwise:
    `{"data":{"emailConfirmed":true,"member":{"status":"member|graduate","since"}|null,"application":{"status","submittedAt","decidedAt","activated"}|null}}`.

  `private, no-store`.

- **Side effects despite GET** (**Source**):
  - links the latest unlinked application with the same confirmed email to this account
    (`membership.account_linked` audit);
  - if reviewers already approved that application, completes activation by inserting
    `public.members` (`membership.activated` audit).

### `GET /v1/me/profile` and `PATCH /v1/me/profile`

- **Location:** [`app/v1/me/profile/route.ts`](../../app/v1/me/profile/route.ts) →
  [`lib/members/profile.ts`](../../lib/members/profile.ts) → `private.get_own_profile`,
  `private.update_member_phone`, `private.update_own_profile`.
- **GET 200** (`data.code: "SUCCESS"`):
  - `name`, `email`, `signInEmail`, `universityId`, `academicYear`, `discipline`, `interests`;
  - `phone`, `hasPhoto`, `photoVersion`, `status`, `memberSince`, `updatedAt`;
  - `application` (status and dates);
  - `changeRequests` (pending, or decided in the last 30 days, at most 10);
  - `features: {photoUploads, profileEditing}`.

  Errors: 403 `MEMBER_REQUIRED` or `EMAIL_UNCONFIRMED`, 404 `NOT_FOUND`. **Side effect:** if the
  Auth email changed to an SQU address no other member uses, `members.email` is updated
  (`member.email_synced` audit).

- **PATCH** body is one of:
  - `{"phone":"+96890000000"}`: always allowed. An invalid phone gets 422 `PHONE_REQUIRED`.
  - `{"phone":null|"+…","academicYear":1-5,"discipline":"<id>","interests":["<id>",…]}`: all
    four keys required; only when `MEMBER_PROFILE_EDITING` is not `disabled`, otherwise 403
    `EDITING_DISABLED`.

  Name, email and student ID are never accepted. Returns the whole profile and writes
  `member.profile_updated`.

### `GET`, `PUT`, `DELETE /v1/me/profile/photo`

- **Location:** [`app/v1/me/profile/photo/route.ts`](../../app/v1/me/profile/photo/route.ts),
  [`lib/members/photos.ts`](../../lib/members/photos.ts).
- **GET:** the member's photo, `image/jpeg`, `private, no-store`, or 404.
- **PUT:**
  - the raw body is `image/jpeg` or `image/png`, ≤ 3 MiB; refused with 403 `UPLOADS_DISABLED`
    when `MEMBER_PHOTO_UPLOADS=disabled`;
  - the image is decoded and re-encoded to a 512 px square JPEG, uploaded to the member-photo
    bucket as `member-photos/<uuid>.jpg`, then saved by `private.set_own_photo`;
  - the previous object is deleted;
  - returns `201 {"data":{"code":"SUCCESS","photoVersion":"<uuid>"}}`;
  - an undecodable image gets 422 and a storage failure 503.
- **DELETE:** always allowed. Clears the photo and deletes the object.
- **Audit:** `member.photo_changed`.

### `POST /v1/me/profile/changes`

- **Body:** `{"field":"full_name|university_id","value":"…"}`, value ≤ 200 characters.
- **Validation:** `private.request_profile_change` validates the value, returns 409 `UNCHANGED`
  if it equals the current value, and 409 `ALREADY_PENDING` if a request for that field is open.
- **Response:** `201` with the whole profile. Audit `member.change_requested`.
- A membership reviewer decides the request in the dashboard (`private.decide_profile_change`).

### `GET /v1/me/events`

Own registrations for published, non-archived events, newest event first, at most 100:
`{"data":{"code":"SUCCESS","registrations":[{eventId,title,eventDate,location,status,attended,checkedInAt,method,registeredAt}]}}`.

**Side effect:** guest registrations made with the member's confirmed email are linked to the
member first (`registration.member_linked`). Source:
[`app/v1/me/events/route.ts`](../../app/v1/me/events/route.ts) → `private.list_own_registrations`.

### `POST /v1/me/events/{eventId}/registrations`

- **Body:** `{"intent":"register|join_waitlist"}` and nothing else. There is no identity field.
- **Rules:**
  - the caller must be a confirmed, active member (`MEMBER_REQUIRED`, `EMAIL_UNCONFIRMED`);
  - the same seat rules as guest registration apply, using the member's name, email and phone;
  - `PHONE_REQUIRED` when the event needs a phone and the profile has none.
- **Rate limit:** 10 attempts per member per 10 minutes. No client IP is used.
- **Responses:** `201 {"data":{"status":"confirmed|waitlisted"}}`, or domain codes as listed
  above.
- **Side effects:** a registration with `member_id`, an attempt row, and audit rows
  (`registration.created` or `registration.waitlisted`, then `registration.member_linked`).

### `GET` and `POST /v1/me/events/{eventId}/attendance`

- **GET 200:**
  `{"data":{"code":"SUCCESS","profile":{name,email,phone},"registration":{status,attended,checkedInAt}|null,"checkinOpen":bool,"closesAt":timestamp|null}}`.
  It links a guest registration with the same confirmed email, as above.
- **POST:**
  - body `{"challenge":"<64 lowercase hex>"}`;
  - succeeds only for a confirmed registration while check-in is open;
  - accepts the code of the current minute or the two before it, so each code lives about three
    minutes;
  - returns `{"data":{"code":"SUCCESS","checkedInAt","alreadyAttended"}}`;
  - repeating it returns the original time without a second audit row;
  - errors `NOT_REGISTERED`, `WAITLISTED`, `CHECKIN_CLOSED`, `CHALLENGE_EXPIRED`,
    `INVALID_CHALLENGE` (409).
- **Location:** [`app/v1/me/events/[eventId]/attendance/route.ts`](../../app/v1/me/events/[eventId]/attendance/route.ts)
  → `private.get_member_event`, `private.confirm_member_attendance`.

## Projects

Contract details: [`docs/api/PROJECTS.md`](../api/PROJECTS.md) and the strict content schema in
[`lib/projects/content.ts`](../../lib/projects/content.ts).

### `GET /v1/projects` and `GET /v1/projects/{id}`

- **Auth:** none. No `Origin` check.
- **Query:** `offset`, an integer 0–1,000,000 (list only). The detail route accepts only
  `offset=0`.
- **Response:**
  `{"data":{"code":"SUCCESS","projects":[{"id","revision","content"}],"total":n,"hasMore":bool}}`.
  The list returns 30 card projections. The detail returns the full published snapshot, or 404.
- **Cache:** `no-store`.
- **Location:** [`lib/projects/api.ts`](../../lib/projects/api.ts) `publicRead` →
  `private.public_projects`.

### `GET /v1/projects/{id}/media/{media}`

- Without a token, it serves only images in the published snapshot.
- With a member token, it also serves the author's and authorized reviewers' unpublished images
  (`private.project_media_key`).
- Returns `image/jpeg` or `image/png`, `private, no-store`, `content-disposition: inline`.
  401 for a bad token, 404 otherwise.

### `/v1/me/projects` routes

| Method and path                             | Body                                                                                       | Success                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /v1/me/projects?offset=0…10000`        | none                                                                                       | `{code, projects, total}`, 30 per page, latest history entry each         |
| `POST /v1/me/projects`                      | `{"operation":"create","content":{…}}`                                                     | `201 {code, id, revision}`                                                |
| `GET /v1/me/projects/{id}`                  | none                                                                                       | Own record with media and the latest 100 history entries (`historyTotal`) |
| `PATCH /v1/me/projects/{id}`                | `{"operation":"save","revision":n,"content":{…}}` or `{"operation":"submit","revision":n}` | `{code, id, revision}`                                                    |
| `POST /v1/me/projects/{id}/media`           | raw `image/jpeg` or `image/png`, ≤ 3 MiB                                                   | `201 {code, id}` (media ID)                                               |
| `DELETE /v1/me/projects/{id}/media/{media}` | none                                                                                       | `{code}`                                                                  |

- **Bodies:** JSON ≤ 64 KiB, with only `operation`, `content` and `revision`.
- **Rules** (`private.project_write`, `private.project_media_change`):
  - only an email-confirmed member with status `member` may write;
  - at most 20 open projects per member (`PROJECT_LIMIT`);
  - a stale revision gets `STALE_REVISION`;
  - submitted, under-review, and approved-but-unpublished revisions cannot be edited
    (`INVALID_TRANSITION`);
  - at most 12 stored images per project and 6 selected (`MEDIA_LIMIT`);
  - an image used by the working or published snapshot cannot be deleted (`MEDIA_IN_USE`).
- **Storage:** images are re-encoded and stored in the project bucket as
  `project-images/<uuid>.<ext>`. An object is removed again if the database write fails.
- **Audit:** project history rows in `private.project_history`.

## Auth callback

### `GET /auth/callback`

- **Location:** [`app/auth/callback/route.ts`](../../app/auth/callback/route.ts),
  [`lib/auth/callback.ts`](../../lib/auth/callback.ts).
- **Purpose:** the landing point of Supabase Auth email links for the **dashboard**: recovery,
  invitation and email change.
- **Query:**
  - `code` (PKCE; needs the recovery-intent cookie set by `/admin/recovery` in the same browser);
  - or `token_hash` and `type` (`recovery`, `invite`, `signup`, `email_change`, `magiclink`,
    `email`);
  - an optional `next`, restricted to safe dashboard paths.
- **Behaviour:** verifies with `verifyOtp` or `exchangeCodeForSession`, writes the session cookies
  on the redirect, deletes the recovery-intent cookie and redirects. Recovery goes to
  `/auth/reset`. Failures go to `…?link=expired` or `…?link=invalid`. Without parameters it
  redirects to the destination, and a URL fragment is handled by `AuthHashRelay` in the root
  layout.

## Dashboard route handlers

All require a dashboard session cookie. They resolve the caller with `getManagerContext()` and
let the database routine decide scope.

| Method and path                                                             | Purpose and rules                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/events/{id}/image`                                              | Cover of an event in the caller's scope (`private.get_admin_event`), any status. 404 when out of scope. `private, no-store`.                                                                                                                                                                                                                                                                             |
| `POST /admin/events/{id}/registrations/export?status=confirmed\|waitlisted` | Requires `isSameOriginPost` (an `Origin` equal to `APP_ORIGIN`, or a loopback origin in development), or 403. Exactly one status. Refuses more than 10,000 rows or 10 MiB, and refuses an export whose row count disagrees with `private.count_admin_registrations`. Audits the export snapshot (`private.export_admin_registrations`). CSV attachment `registrations-<id>-<date>.csv`, formula-escaped. |
| `POST /admin/events/{id}/attendance/export`                                 | Same-origin guard. Form body (≤ 4 KiB) with exactly one `filter` and one `search`. At most 10,000 rows (`private.list_event_attendance`). CSV `attendance-<id>.csv` with a Method column and no phone numbers.                                                                                                                                                                                           |
| `GET /admin/membership/{id}/document`                                       | Membership reviewers only (`private.can_review_membership`), otherwise 403. Never the reviewer's own application. The view is audited (`private.get_membership_document`). Returns the original bytes with `private, no-store`, a restrictive CSP and `content-disposition: inline`. 404 after the decision deleted the card.                                                                            |
| `GET /admin/projects/{id}/media/{media}`                                    | A project image the caller may see (`private.project_media_key`), `private, no-store`.                                                                                                                                                                                                                                                                                                                   |

## OpenAPI inconsistencies

Found by comparing [`docs/api/openapi.v1.yaml`](../api/openapi.v1.yaml) with the handlers:

1. **Missing paths:** all seven project paths (`/projects`, `/projects/{id}`,
   `/projects/{id}/media/{media}`, `/me/projects`, `/me/projects/{id}`, `/me/projects/{id}/media`,
   `/me/projects/{id}/media/{media}`). They are documented only in `docs/api/PROJECTS.md`.
2. **Servers:** OpenAPI lists `https://api.essqu.com/v1` as "Planned custom domain, deferred", but
   it serves production (**Deployed**, 2026-10-24).
3. **Profile fields:** [`docs/api/EVENT_ATTENDANCE.md`](../api/EVENT_ATTENDANCE.md) still
   describes `GET /v1/me/profile` as `{code,name,email,phone}`. The handler returns the full ADR
   0023 profile and `features`.
4. **GET side effects:** `GET /me/membership`, `GET /me/profile`, `GET /me/events` and
   `GET /me/events/{id}/attendance` can write (linking, activation, email sync). Read the
   OpenAPI's GET semantics with this in mind.
