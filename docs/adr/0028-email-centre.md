# ADR 0028: Email Centre

Accepted on 2026-11-22 by the owner's request "Implement the agreed dashboard improvements"
(section 3: Email Centre). Migration `0036_email_centre` implements it. The sender address, the
Cloudflare configuration and the choice of email provider are **deferred by the owner**; nothing
here chooses or configures a provider, changes DNS or sends real email.

## Decision

### Access

- **Communications → Email Centre** (`/admin/communications/email`) needs the permission
  `email.send` (ADR 0027). It is assigned explicitly: initially Board Administration has it; any
  committee or team can be given it. A holder may email eligible members **across all committees
  and teams**; recipients are never limited to the sender's own committee.

### Audience

- Filters, combined: member category, institution (self-reported affiliation), academic year,
  discipline, interests, membership status, SQU verification status (verified, pending, not
  verified, separate from the self-reported institution), leadership position (Chief, Assistant
  Chief, any active leader), committee and team, and individually included or excluded members.
- Different filters narrow together (AND); several values within one filter match any of them (OR).
  A committee matches its roster members and its leaders (committee level or any of its teams); a
  team matches its leaders. When a leadership filter is combined with a committee or team, the
  appointment must be in that committee or team. The academic-year filter applies only to members
  who have a year (students); others are excluded by it, and the page says so.
- Included members are added to the filtered audience, excluded members removed. Everyone is
  deduplicated by email.
- **Eligibility, always applied:** a members row (activation only follows approval), membership
  status in the selected statuses (default `member`), subscribed to announcements, and an address
  that is not suppressed. Everything the Email Centre sends is an optional announcement, so the
  member's unsubscribe choice always applies; there is no "service" message type.
- The preview is server-side: a count and one page of 25 recipients, searchable by name or email.
  No member list is sent to the browser beyond that page.

### Messages

- English and Arabic subject and body, sent in English, Arabic or both. The body is a small,
  safe formatting language (paragraphs, headings, bold, italic, lists and `https` links) rendered on
  the server to escaped HTML and plain text; raw HTML is never accepted. `{{name}}` inserts the
  recipient's name.
- Drafts and reusable templates are stored. A **test** goes only to the sender's own sign-in
  address and is audited.
- **Final confirmation** shows the audience and the exact recipient count. Queuing recounts; if the
  count changed, the sender confirms again. Queuing snapshots the recipients as one delivery each
  (individual delivery: no shared To or Cc), unique per campaign and address, so a campaign cannot
  be sent twice.

### Delivery

- Provider-independent: `lib/email/transport.ts` defines the interface. Until the owner chooses a
  provider, sending is **disabled** (drafts, audience and preview still work) and the page says why.
  A test adapter (`EMAIL_TRANSPORT=test`, refused in production) records messages for tests.
- **Background sending** in bounded batches (25 per batch), with durable progress in
  `private.email_deliveries`. Each batch completes inside one request: the campaign page drives
  batches while it is open, and `POST /v1/internal/email-dispatch` (authorized by
  `EMAIL_DISPATCH_SECRET`) lets any scheduler continue them. Nothing relies on work continuing after
  a response.
- **Before each send** the database rechecks that the person who queued the campaign still holds
  `email.send` (otherwise the campaign is halted and the rest skipped) and that the recipient is
  still eligible (member, status, subscription, suppression).
- Leases make concurrent batches safe; the delivery id is the provider idempotency key, so a retried
  send after a crash cannot duplicate a message the provider already accepted.
- Results: **accepted** (the provider took it) is not **delivered**. A delivery becomes delivered,
  bounced or complained only from provider evidence (`private.email_record_event`), which needs the
  provider's webhook (deferred). Temporary failures retry with back-off up to five attempts;
  permanent failures are reported with their reason; an invalid address is suppressed.
- **Unsubscribe:** every message carries a signed one-click link (`EMAIL_UNSUBSCRIBE_SECRET`) and
  `List-Unsubscribe` headers. Members can also turn announcements off on their website profile.

## Consequences

- New tables: `email_preferences`, `email_suppressions`, `email_templates`, `email_campaigns`,
  `email_deliveries`, private and under forced RLS like every private table.
- Deleting a membership record deletes that member's delivery rows and preference.
- Going live needs: a provider adapter, a verified sender address, `EMAIL_FROM`,
  `EMAIL_UNSUBSCRIBE_SECRET`, `EMAIL_DISPATCH_SECRET` and a scheduler for the dispatch route
  (see `docs/how-to/email-centre.md`). Live delivery has not been verified.
