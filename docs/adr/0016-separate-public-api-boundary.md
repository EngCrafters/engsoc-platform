# 0016 — Separate the public landing site from Core behind a versioned HTTP API

Status: accepted
Date: 2026-10-17
Related: ADR 0004, ADR 0012, ADR 0015, `docs/HARDENING_PRE_PUBLIC_API.md`

## Context

A public-site migration that put the marketing front end inside this repository
was evaluated and **rolled back** (`60e2e28`, merge `1194f462`). Its history is
preserved; the architecture is not.

What that exercise established: the landing site and the Core platform have
different owners, release cadences and risk profiles, but the Core must remain
the only authority for events, registrations, capacity, waitlist ordering,
duplicate prevention, rate limiting, audit and administrative access. The two
requirements are only compatible across an explicit contract.

The organization now uses one domain with subdomains, and the landing site will
be its own repository and its own Vercel project.

## Decision

- `essqu.com` — public landing site, separate repository, separate Vercel project;
- `www.essqu.com` — redirects to `essqu.com`;
- `api.essqu.com` — Core Public API, this repository;
- `admin.essqu.com` — Core administration and Auth, this repository, same Vercel project as the API;
- the API is versioned **in the path**: `/v1`;
- the API is a **transport adapter only**: HTTP route → API adapter →
  `lib/events` / `lib/registrations` → `app_runtime` → `private.*` routine;
- no browser code talks to Supabase or Postgres directly, in either application;
- event reads are server-to-server and authenticated with a scoped API client
  credential; registration is a public browser POST with no API key and no cookie.

## Consequences

### Positive

- The landing site can ship independently, in its own repository, without
  touching the Core's release line.
- A stable, documented, versioned contract exists that another team can build
  against without reading Core source.
- The team boundary is explicit: Core owns data and rules, landing owns
  presentation.
- Additional consumers (a future mobile app, an archive site) become possible
  without new Core coupling.
- Core remains the single source of truth, so there is exactly one answer to
  "is this event full?".

### Costs, accepted deliberately

- One network hop on every public event read.
- CORS and exact-origin validation become Core's responsibility for registration.
- API version governance and a backward-compatibility policy.
- Contract drift risk between two repositories, mitigated by a checked-in
  OpenAPI document and contract tests.
- A new failure mode: the landing site is down when the API is down.

## Rejected

- **Copying events into the landing site.** Two sources of truth; capacity and
  waitlist state would go stale and disagree.
- **Direct Supabase reads/writes from the browser.** Would require an anon-key
  surface over business tables and would put authorization decisions in the
  client.
- **Service-role integration.** Hands the landing site database authority it
  must never hold.
- **Reimplementing registration in the landing site.** The rules live in
  PostgreSQL routines precisely so they cannot be re-derived differently.
- **Pinning Core's UI into the landing site** — the rolled-back approach.

## Supersedes

Where an earlier document asserts that the platform needs no API layer, this ADR
supersedes that statement for the public boundary. Historical documents are left
intact rather than rewritten.
