# 0005: Registration rate limiting via a request-log table

## Status

Accepted

## Context

UC-02's registration form (`app/(marketing)/`) is public and unauthenticated
by design — no login required, per the use case's main flow. A public,
unauthenticated write endpoint is a spam target regardless of whether it's
a Server Action or a REST API route; removing the API layer (see the repo
restructuring this ADR ships alongside) doesn't remove that exposure.

The agreed protection is simple on purpose: reject a registration attempt if
the same IP address has submitted more than 5 times in the last 10 minutes.
This is not meant to stop a determined attacker (IPs are trivially rotated),
it's meant to stop naive scripted spam and accidental double-submits.

Two implementation shapes were considered:

1. A dedicated `registration_attempts` table: one row per attempt, queried
   for a count in the last 10 minutes before allowing another.
2. An in-memory counter (e.g. a module-level `Map<ip, timestamps[]>`).

Option 2 was rejected: Vercel Functions are not guaranteed to reuse the same
instance between requests, so an in-memory counter would silently reset per
cold start and undercount, giving a false sense of protection.

## Decision

- New table `registration_attempts`: `id` (uuid pk), `ip_address` (inet,
  not null), `created_at` (timestamptz, not null, default now()).
- Composite index on `(ip_address, created_at)` — the lookup is always "this
  IP, in this time window," an equality + range query, so index column
  order follows that.
- A row is written for every attempt (allowed or rejected), not just
  successful ones, so the count reflects actual request volume.
- This table is not part of the ER diagram's real-world entity model (see
  `docs/Technical_Blueprint.pdf`, Part 2) — it doesn't model a person, event,
  or registration, only abuse-prevention bookkeeping. The diagram should
  still get a short note added near `registrations` pointing at this ADR, so
  its existence isn't a surprise when someone reads schema.ts against it.

## Consequences

- **No cleanup job yet.** Rows accumulate forever. Fine at current volume;
  before this matters, add either a `pg_cron` job or a check in the Server
  Action itself that opportunistically deletes rows older than, say, 1 hour.
  Not built now — flagging it here so it isn't forgotten, not guessing at a
  cron schedule that isn't a real requirement yet.
- **Count-then-insert isn't atomic.** Two requests from the same IP arriving
  within the same few milliseconds could both read a count under the limit
  and both insert, technically allowing slightly more than 5 in rare cases.
  Acceptable for "naive spam and double-submit" protection; would need a
  transaction with an advisory lock (or a different data shape entirely) if
  this ever needs to be a hard guarantee.
- Every place that queries this table must scope by both `ip_address` and a
  `created_at` window — an unscoped scan defeats the index and, more
  importantly, isn't the decision that was made here.
- RLS is not enabled on this table, consistent with the other 6 tables in
  this database — see the open RLS decision tracked separately, this ADR
  doesn't resolve it, just doesn't make it worse.

## Source

Requested directly by Hisham alongside the `app/(marketing)/` repo
restructuring: "the same simple rate-limit protection we discussed before
(a table-backed check: reject if the same IP has submitted more than 5
times in 10 minutes)."
