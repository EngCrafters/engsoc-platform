# 0003: Resend for email

## Status

Accepted

## Context

Registration and certificate emails (UC-01, UC-04) need to arrive
reliably. The alternative was running a mail server ourselves.

## Decision

Send confirmation and certificate emails through Resend rather than a mail
server we manage. This decision is unchanged from the earlier version of
`docs/Technical_Blueprint.pdf` — it wasn't affected by the Cloudflare →
Vercel/Supabase stack change.

## Consequences

- Resend's free tier covers the society's current email volume at no cost.
- Running a mail server is real infrastructure work — deliverability,
  spam reputation, DKIM/SPF/DMARC setup, ongoing maintenance — with no
  learning value for the team relative to the effort it costs.
- `RESEND_API_KEY` is a server-only secret; sending still requires a
  verified sending domain on Resend before emails will actually deliver.

## Source

`docs/Technical_Blueprint.pdf`, Part 1 — ADR-04 (unchanged).
