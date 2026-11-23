# Email Centre: configuration and going live

The Email Centre ([ADR 0028](../adr/0028-email-centre.md)) is built and tested, but **sending is
off**: the owner deferred the choice of email provider, the sender address and the Cloudflare
(DNS) configuration. Until then the page at `/admin/communications/email` lets holders of
`email.send` build audiences, write and preview messages, and keep drafts and templates; the send
and test buttons stay disabled and the page says why.

## What exists

| Piece                 | Where                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Database              | Migration `0036_email_centre`: drafts, templates, deliveries, preferences, suppressions  |
| Audience and dispatch | `private.email_audience_members`, `email_claim_deliveries`, `email_complete_delivery`    |
| Message format        | [`lib/email/format.ts`](../../lib/email/format.ts): escaped HTML and plain text          |
| Transport boundary    | [`lib/email/transport.ts`](../../lib/email/transport.ts): `EmailTransport`, test adapter |
| Batches               | [`lib/email/dispatch.ts`](../../lib/email/dispatch.ts): 25 per batch, 120 s lease        |
| Scheduler entry       | `GET`/`POST /v1/internal/email-dispatch` (bearer secret)                                 |
| Unsubscribe           | `GET`/`POST /v1/email/unsubscribe?token=` and the website profile switch                 |

## Going live (owner decisions first)

1. **Choose the provider** and verify the sending domain and sender address with it (SPF, DKIM,
   DMARC through the DNS provider). This is outside the repository.
2. **Add its adapter** in `lib/email/transport.ts`: a class implementing `EmailTransport` whose
   `send` maps the provider's answer to `accepted` (with its message id), `temporary` (rate limit,
   timeout, 5xx) or `permanent` (with `invalidAddress` for an address the provider rejects). Pass
   `idempotencyKey` as the provider's idempotency key and every entry of `headers` as a header. Read
   the API key from one new server-only variable. Select it when `EMAIL_TRANSPORT` names it.
3. **Configure** (see [Configuration](../reference/configuration.md#email-centre-adr-0028)):
   `EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_UNSUBSCRIBE_SECRET` (32+ random characters),
   `EMAIL_DISPATCH_SECRET` (32+ random characters) and `APP_ORIGIN`.
4. **Schedule the dispatch route** so campaigns continue when nobody has the page open, for
   example a Vercel Cron job calling `/v1/internal/email-dispatch` every few minutes with
   `CRON_SECRET` set to the same value as `EMAIL_DISPATCH_SECRET`. Each call sends at most one batch
   and finishes before answering.
5. **Wire provider events** (optional but recommended): a webhook route that verifies the
   provider's signature and calls `private.email_record_event(providerMessageId, event, detail)` for
   `delivered`, `bounced` and `complained`. Only then can the page show messages as delivered, and
   bounced or complaining addresses are suppressed automatically.
6. **Verify with a controlled inbox**: send yourself a test from the page, check headers
   (`List-Unsubscribe`, `List-Unsubscribe-Post`), the unsubscribe link, both languages and the
   plain-text part. Then a small campaign to a test audience (include or exclude members by hand).

Until step 6 passes, live delivery remains **unverified** ([Known gaps](../known-gaps.md)).

## Operating notes

- A campaign never sends twice: queuing turns a draft into deliveries once, unique per address.
- Stopping a campaign skips the messages not yet handed to the provider; accepted ones cannot be
  recalled.
- If the sender loses `email.send`, the next batch halts the campaign and skips the rest.
- A member who unsubscribes, is suppressed or stops being an eligible member before their turn is
  skipped, with the reason shown on the campaign page.
- Rotating `EMAIL_UNSUBSCRIBE_SECRET` invalidates unsubscribe links in messages already sent;
  members can still use the switch on their profile.
