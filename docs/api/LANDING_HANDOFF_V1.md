# Core Public API v1 — landing handoff

Planned public site: https://essqu.com
Planned API: https://api.essqu.com
Planned admin: https://admin.essqu.com
API version: **v1**

**Pre-domain status (October 18, 2026):** These hostnames have not been attached
or cut over. Core currently serves at `https://engsoc-platform.vercel.app`.
The private `EngCrafters/essqu-web` repository preserves source
`17bdcc4244f608a5b3ec8361db470ec1ae32a8c0` and is Git-connected to the separate
Vercel `essqu-web` project. `EngCrafters` is a GitHub User namespace.
Staging has migration 0024; staging provisioning and live integration checks
remain pending. Production has no migration 0024 or production read credential;
production 0024 awaits live staging and concurrency verification under the owner's
specific backup-risk waiver; no backup has been established. Consult
[current work](../CURRENT_WORK.md) and the
[custom-domain checklist](CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md) before configuring
a consumer. Do not point Landing at an unverified API or copy a production key
into staging.

The contract is `docs/api/openapi.v1.yaml`. This page is the practical
companion: how to call it, and what you must not do.

## Environment variables the landing site needs

| Variable              | Scope           | Purpose                         |
| --------------------- | --------------- | ------------------------------- |
| `CORE_API_BASE_URL`   | server          | e.g. `https://api.essqu.com/v1` |
| `CORE_EVENTS_API_KEY` | **server only** | bearer token for `events:read`  |

That is the complete list. The landing site must **never** need
`DATABASE_URL`, `APP_RUNTIME_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or any
Core admin credential. If you find yourself needing one, stop — the boundary is
being crossed the wrong way.

`CORE_EVENTS_API_KEY` must not appear in `NEXT_PUBLIC_*`, in client
components, in a browser bundle, or in a public build log.

## Event list (server-to-server)

`@
GET {CORE_API_BASE_URL}/events?period=upcoming
Authorization: Bearer {CORE_EVENTS_API_KEY}
`@

- `period`: `upcoming` (default) or `past`.
- `cursor`: pass `meta.nextCursor` back verbatim. It is opaque; do not
  construct, decode or persist it as a stable id.
- Page size is fixed at 20 by Core. There is no `limit` parameter in v1.
- Response: `{ "data": [...], "meta": { "nextCursor": string | null } }`.

Cache guidance: Core sends `Cache-Control: public, s-maxage=30,
stale-while-revalidate=120`. You may cache the parsed result server-side for up
to 30 seconds. Do not cache past a `nextCursor` boundary as if the list were
complete.

## Event detail

`@
GET {CORE_API_BASE_URL}/events/{eventId}
Authorization: Bearer {CORE_EVENTS_API_KEY}
`@

A draft, archived or nonexistent event all return **404**. Do not treat a 404 as
"the event was deleted" — it means "not publicly available".

## Registration (browser, no API key)

`@
POST {CORE_API_BASE_URL}/events/{eventId}/registrations
Content-Type: application/json
Origin: https://essqu.com

{ "attendeeName": "...", "attendeeEmail": "...", "intent": "register" }
`@

- No credentials, no cookie, no API key. Do not attach the events key.
- `intent` is `register` (default) or `join_waitlist`.
- Do **not** send an IP address. Core derives it. An extra field is rejected.
- Success is `201` with `{ "data": { "status": "confirmed" | "waitlisted" } }`.

## CORS

Allowed production origins are exact matches:
`https://essqu.com` and `https://www.essqu.com`. There is no wildcard and no
`*.vercel.app`. Preview deployments are **not** allowed by default; a stable
staging landing hostname is configured explicitly instead.

If `www.essqu.com` always redirects and never serves the app, it can be removed
from the allowlist later.

Allowed-origin responses expose `X-Request-Id` and `Retry-After` to browser
JavaScript through `Access-Control-Expose-Headers`.

## Error handling

Errors are `application/problem+json` with a stable `code`:

| Status    | code                                           | Meaning for the landing site                                                                              |
| --------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 400       | `bad-request`                                  | Malformed body. A bug on your side.                                                                       |
| 401       | `unauthorized`                                 | Read credential missing, malformed, unknown, wrong-hash, inactive, revoked, expired or wrong-environment. |
| 403       | `forbidden`                                    | Registration origin not allowed, or a valid active read credential lacks `events:read`.                   |
| 404       | `not-found`                                    | Unknown event, or not public.                                                                             |
| 409       | `conflict`                                     | Already registered, full, closed, etc. Show the message, do not retry.                                    |
| 413 / 415 | `payload-too-large` / `unsupported-media-type` | Fix the request.                                                                                          |
| 422       | `invalid-fields`                               | Show `errors[].field`.                                                                                    |
| 429       | `rate-limited`                                 | Back off. Honour `Retry-After`.                                                                           |
| 503       | `service-unavailable`                          | Core problem. Show a neutral message and retry later.                                                     |

Never display `type` or `requestId` to a visitor. Log `requestId` — it is how
a failure is traced across the two systems.

Registration `409` responses can include an optional `reason`. The existing
`code: "conflict"` and status remain unchanged. Handle these reasons explicitly:

| reason                   | Visitor guidance                                                            |
| ------------------------ | --------------------------------------------------------------------------- |
| `already-registered`     | This email is already registered.                                           |
| `already-waitlisted`     | This email is already on the waitlist.                                      |
| `event-full`             | Offer an explicit waitlist choice; never submit it automatically.           |
| `registration-closed`    | Registration is closed.                                                     |
| `registration-available` | Seats are available; offer normal registration instead of waitlist joining. |

If `reason` is absent (including older Core deployments) or unknown, show a
generic conflict message and let the visitor refresh. Do not infer a reason
from the problem title or retry automatically.

## Retry policy

- Reads: retry once on `503` with a short backoff. Do not retry `401`/`403`.
- Registration: **no automatic retries.** Disable the submit button while the
  request is in flight. A duplicate submission is a `409`, not an idempotent
  success.

## Request IDs

Send `X-Request-Id` if you have a correlation id (8–128 chars of
`A-Za-z0-9._-`). Core echoes a valid one back and generates one otherwise.
Include it when reporting a problem.

## Key rotation

1. Core creates a new client with the same scope.
2. You install the new key on the landing server and deploy.
3. Verify traffic.
4. Core revokes the old key.

Old and new are both valid during step 2, so rotation needs no downtime and no
synchronised cutover. For an emergency, Core revokes the key and the reads fail
closed — deploys do not need to be coordinated.

## Integration testing

Point a staging landing deployment at the staging Core with a staging-only key.
Never use production attendee records to exercise registration. Core's own
registration tests run against a disposable database, and you should do the same.

## What this API deliberately does not do

- No administrative endpoints. Admin lives at `admin.essqu.com` behind Supabase
  Auth and `administrative_access`.
- No event write endpoints.
- No attendee data of any kind. The registration endpoint returns only a status.
