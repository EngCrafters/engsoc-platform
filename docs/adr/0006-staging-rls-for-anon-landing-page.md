# 0006: Minimal RLS on staging for the anon-key landing page

## Status

Accepted historical baseline — scoped to the staging Supabase project only.
ADR 0008 and `docs/UC-02_Data_and_Security.md` specify the target replacement,
including removal of direct anon INSERT. That design is not yet applied;
production RLS remains a release prerequisite. The historical context below
does not authorize reviving a separate application or bypassing the new gate.

## Context

A second repo (`EngCrafters/landing-page`, owned by a teammate outside the
core team) connects to the staging Supabase project using only the public
anon key — no service role key, no direct database connection, ever. The
plan for that repo assumes "Row Level Security is what keeps this safe
regardless of what the code does."

That assumption was checked against the actual staging project and found
false: RLS was disabled on all 8 tables (`get_advisors`, `rls_disabled_in_public`,
ERROR level), the same deferred state as production. With RLS off, the anon
key has full read/write access to every table — including `members` (real
names, emails, university IDs) — not just the two tables the landing page
actually needs. Shipping the anon key into a second, externally-owned repo
in that state, with a README telling the owner "RLS keeps this safe," would
be actively wrong.

This ADR enables RLS on staging with the minimum policies the landing page
needs, nothing more — it does not attempt to design the full production
access model (who-sees-which-committee's-events, exports, etc.) that
CLAUDE.md's admin dashboard section still marks open.

## Decision

On the **staging project only**:

- RLS enabled on all 8 tables (`archive_items`, `certificates`,
  `committees`, `events`, `members`, `mentorship_connections`,
  `registration_attempts`, `registrations`). Enabling RLS with zero
  policies on a table means default-deny for every role — strictly safer
  than the previous disabled state even for tables the landing page never
  touches.
- One SELECT policy, on `events`, for the `anon` role: `status = 'published'`.
  Matches `getPublishedEvents()` in both this repo and the landing page
  exactly — a draft or full event is never visible to the anon key.
- One INSERT policy, on `registrations`, for the `anon` role:
  `member_id IS NULL` (enforces the no-member-profile-yet rule from
  `docs/adr/0004` at the database level, not just in application code) AND
  the referenced event must currently be `published` (blocks registering
  for a draft or nonexistent event via a raw REST call that bypasses
  application validation entirely). No SELECT policy on `registrations` —
  the landing page never reads registrations back, so it doesn't get read
  access it doesn't need.
- No policies added for `authenticated` — real login (UC-01) doesn't exist
  yet, so there's nothing to scope for that role right now.

**Production is deliberately left untouched** — same RLS-disabled state as
before this ADR. That's a real, tracked asymmetry between the two
environments, not drift: staging now has narrower policies than production
does, until the open production RLS decision gets made.

## Consequences

- The landing page's `submitRegistration()` must not chain `.select()`
  after `.insert()` — there's no SELECT policy backing that, it would fail.
- **The app-level rate limit (`docs/adr/0005`) does not apply here.** That
  limiter lives in core-platform's Server Action, which the landing page
  doesn't go through — its anon-key INSERT goes straight to PostgREST. A
  script with the (public) anon key could submit registrations directly,
  bypassing the 5-per-10-minutes check entirely. Not solved by this ADR;
  flagging it as a known gap rather than pretending RLS covers it too.
- When the production RLS decision finally gets made, these staging
  policies are a reasonable starting draft for the `events`/`registrations`
  half of it — not a complete answer, since production's role-based access
  (which committee sees which events) is a separate, larger design than
  what a public anon key needs.

## Source

Requested directly by Hisham while setting up `EngCrafters/landing-page`;
the RLS gap was found by checking the "RLS keeps this safe" premise against
`get_advisors` output rather than assuming it.
