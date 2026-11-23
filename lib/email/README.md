# Email Centre library

The Email Centre's server side ([ADR 0028](../../docs/adr/0028-email-centre.md), migration 0036).
Every routine it calls checks `email.send` (or, for dispatch, runs only after Core authorized the
caller); nothing here decides who may send.

- `server.ts`: typed wrappers for the `private.email_*` routines and the member's own preference.
- `format.ts`: the message format. A small Markdown subset rendered to escaped HTML and plain text;
  raw HTML is never accepted; links are `https` or `mailto` only; `{{name}}` personalizes. Pure,
  unit tested.
- `transport.ts`: the provider boundary (`EmailTransport`) and `emailConfiguration()`, which says
  whether sending is configured and why not. Only the recording `TestTransport` exists, because the
  provider is deferred; it is refused in production.
- `unsubscribe.ts`: signed one-click unsubscribe tokens (HMAC of the delivery id).
- `dispatch.ts`: `dispatchEmailBatch()`, one bounded batch (25) that claims leased deliveries,
  renders, sends individually with the delivery id as idempotency key, and records each outcome.
  It finishes before returning.

Callers: `app/admin/(protected)/communications/email/actions.ts`,
`app/v1/internal/email-dispatch/route.ts`, `app/v1/email/unsubscribe/route.ts` and
`app/v1/me/email-preferences/route.ts`.

Tests: `tests/email-centre.test.ts` (format, tokens, configuration, batches, routes),
`tests/db/email-centre.test.ts` (routines under the real roles) and
`tests/profile-flow/permissions-email.spec.ts` (browser; sending with `EVENT_FLOW_EMAIL=test`).
Going live: [docs/how-to/email-centre.md](../../docs/how-to/email-centre.md).
