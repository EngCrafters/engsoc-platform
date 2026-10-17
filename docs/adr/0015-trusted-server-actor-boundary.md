# 0015 — The trusted-server actor boundary (F-04 disposition)

Status: accepted
Date: 2026-10-17
Supersedes: nothing
Related: `docs/UC-02_Data_and_Security.md`, `docs/ACCESS_CONTROL.md`, ADR 0012

## Context

The audit recorded F-04 as an open question rather than a defect:

> PostgreSQL trusts the actor UUID supplied by trusted server code.

That sentence is true of every routine in `private.` that takes `p_actor uuid`.
The concern behind it is real: if a client could ever choose that UUID, the
authorization model would collapse, because the routines would be checking
`administrative_access` on behalf of an identity the caller picked.

Before deciding anything, this analysis asked where an actor UUID can actually
enter the system.

## Findings (grounded in the current tree, not in the audit's prose)

1. **Every actor is a plain `string` argument on a `server-only` module.**
   `lib/access/server.ts` and `lib/admin-events/server.ts` both receive
   `actorId` as a parameter and interpolate it as `${actorId}::uuid`. They
   begin with `import "server-only"`, so they cannot be pulled into a client
   bundle.
2. **No Server Action reads an actor identity from the request.**
   A repository search for a form field such as `actor`, `actorId`, `userId`
   or `memberId` read out of `FormData` returns nothing. Actions resolve the
   actor themselves.
3. **The actor comes from the authenticated session.**
   `lib/auth/manager.ts` obtains it from `supabase.auth.getUser()` — a
   server-side verification of the session cookie, not a decoded claim the
   client supplied.
4. **The routines re-check authorization on every call.**
   Each protected routine validates the actor against current
   `administrative_access` through `private.can_access_committee` and its
   siblings. Stale or over-broad actor state cannot outlive a revoked grant,
   because the check happens at call time inside the same transaction.

Read together: the actor UUID is a **capability the server hands to the
database about itself**, and the only thing that can produce it is a verified
session. Nothing on the public boundary can influence it.

## Decision

**Accept and track F-04 as a trusted-server-boundary risk. Do not redesign the
authorization model.**

The reasoning is about marginal benefit versus blast radius. Closing F-04
"properly" would mean changing how routines receive identity — for example
passing a signed session token into the database and verifying it inside
PostgreSQL, or introducing a second local role table. Both would:

- duplicate or replace `administrative_access` as the authorization source,
  which `docs/ACCESS_CONTROL.md` names as canonical;
- move session verification into SQL, widening the database's authority rather
  than narrowing it;
- add a new failure mode to every protected operation at once.

Against that, the concrete exposure is: _a server-side bug that passes the wrong
actor string_. That is a code-review concern, already constrained by
`server-only` and by routines that re-check. A redesign would not prevent it
either — any implementation still has to name the actor somewhere.

## Preconditions that would invalidate this decision

Re-open this ADR immediately if any of the following becomes true:

1. A Server Action, route handler, or API endpoint ever reads an actor
   identifier from client input, including a header, query parameter, JSON body
   or form field.
2. A new write path calls a `private.` routine while running as a database role
   that is not `app_runtime` or `app_maintenance`.
3. A protected routine is added that does **not** re-check
   `administrative_access` at call time.
4. `SUPABASE_SERVICE_ROLE_KEY` is used for anything other than the established
   Auth Admin module.
5. A routine begins accepting an actor identity from `request.jwt.claims`
   without verifying the token signature.

## Consequences

- The public API introduced in ADR 0016 **must never accept an admin actor from
  a public client.** The API surface defined there has no administrative
  endpoints at all; `/v1` is read-only plus public registration, and
  registration supplies no actor (the routine records `anonymous`).
- This disposition is recorded in `docs/HARDENING_PRE_PUBLIC_API.md` alongside
  the other hardening findings.
- The residual risk is documented rather than implied, so a future reader does
  not have to re-derive whether the boundary was considered.
