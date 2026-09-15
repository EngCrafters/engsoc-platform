# 0008: UC-02 specification gate and data/security contract

## Status

Specification checkpoint, September 15, 2026. The owner requires a complete
design gate before additional UC-02 application implementation.
O-01 (publication approval authority) remains owner-dependent.
This ADR does not authorize a migration or certify a completed freeze.

## Context

UC-02 preceded Member profiles, and the existing public implementation was
partial. The requirements still explicitly include a waitlist, review when
required, permanent records, scoped committee access and traceable changes.
The initial deep dive left these and the anonymous-write boundary unresolved.

## Decision

Use these authoritative UC-02 documents:

- [Deep dive](../UC-02_Deep_Dive.md): behavior, source classification, owner
  decisions and freeze checklist.
- [Data/security contract](../UC-02_Data_and_Security.md): target ER addendum,
  fields, migration plan, authorization/RLS and concurrency.
- [Acceptance/delivery](../UC-02_Acceptance_and_Delivery.md): behavior tests,
  security denials, milestones and release evidence.

The owner authorizes engineering defaults for true gaps. The decision register
distinguishes project-backed decisions from selected defaults. Organizational
approval authority is not inferred from industry guidance. Finalize O-01 and
all dependent contracts before marking the specification frozen.

Architectural changes specified for the post-freeze implementation:

- Keep Registration as the attendee identity with optional Member. A status
  supports the required waitlist and retained legacy duplicates; no new Attendee.
- Add optional capacity and serialize seat allocation/promotion/event edits
  under one event lock, backed by active event/email database uniqueness.
- Retain the deliberate event enum, defining stored full as manual hold;
  derive numerical fullness and past state rather than storing counts.
- Grant committee managers through auth.users independently of Member.
- Add permanent private audit history and non-destructive event archiving.
- Replace raw anon registration INSERT with a restricted server operation;
  explicit RLS and grants protect all exposed tables.

## Supersession and implementation boundary

ADR 0004 remains accepted; the new ER addendum renders its nullable link.
ADR 0005's five-per-ten-minute rule remains; its non-atomic check, indefinite
attempt retention and deferred RLS are replaced by the target contract at
cutover. ADR 0006 remains the historical applied staging baseline, not the final
UC-02 security model. Its raw anon INSERT is intentionally retired with tests.
Technical Blueprint v1 remains historical; use the UC-02 addendum for these
specific later decisions. Unrelated use cases and their open policies remain
unchanged. No historical PDF or applied migration is rewritten.

## Consequences

Application work is paused by the explicit specification gate until O-01 and
its dependent design are settled. Independent specification work proceeds.
After complete freeze, commit/push/verify it, then implement the first
dependency-ordered milestone automatically under ADR 0007.
Production RLS and database cutover are explicit release prerequisites.
Neither an existing live deployment nor green compilation proves those
boundaries safe.
