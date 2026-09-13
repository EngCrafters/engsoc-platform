# 0004: Nullable memberId on Registration

## Status

Accepted

## Context

Build order has been deliberately reordered: UC-02 (event/workshop
announcement, registration, and an admin dashboard) is being built before
UC-01 (member profiles). UC-01 is deferred, not cancelled.

`docs/Technical_Blueprint.pdf`'s ER diagram (Part 2) shows
`registrations.member_id` as required — a registration always belongs to a
Member. That was correct when UC-01 was assumed to exist first. It no
longer holds: registering for an event must work with no member profile in
existence yet, since UC-01 hasn't been built.

Two options were considered:

1. Make `registrations.member_id` nullable and add fields to `registrations`
   that capture who the person is without a Member row.
2. Introduce a separate `Attendee` entity that a registration points to
   instead of (or alongside) `Member`.

Option 2 was rejected: it adds an entity now that would likely get merged
into `Member` later once UC-01 ships and people link their past
registrations to a profile. That's schema churn without real benefit at
this stage. Keeping one `Registration` table with an optional `memberId` is
the smaller, more honest change.

## Decision

- `registrations.memberId` changes from `NOT NULL` to nullable.
- Two new required fields on `registrations`: `attendeeName` (text) and
  `attendeeEmail` (text). This is how a registration captures who the
  person is when there's no Member row yet.
- When UC-01 ships, a person will be able to link their past registrations
  to their new member profile, likely matched by email. That linking flow
  is not built yet — this decision only keeps the schema from blocking it
  later, it doesn't implement it.

## Consequences

- Every place that currently assumes `registration.memberId` is always
  present (certificate generation, attendance display, and any future UC-02
  admin dashboard views) must handle the null case explicitly.
- `docs/Technical_Blueprint.pdf`'s ER diagram (Part 2) is now out of date on
  this one point and should be updated to match; this ADR is the record of
  why it no longer matches until that happens.
- No `Attendee` entity is introduced. If a real need for one emerges later,
  that's a new ADR, not an assumption baked in now.

## Source

`CLAUDE.md`, "Current build decision: event registration without member
accounts."
