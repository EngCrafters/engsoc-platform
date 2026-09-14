# UC-02 Deep Dive: Website event and workshop announcement + registration

**Status:** Working implementation specification. It records the approved UC-02 flow and the later build-order decision in `CLAUDE.md` / `docs/adr/0004-nullable-member-id-on-registration.md`. Items marked **OPEN** need an explicit product or security decision before the affected work ships.

## 1. Scope and governing flow

This document elaborates UC-02 in `docs/Idea_and_Requirements_Document.pdf`, page 7. That PDF remains the authoritative requirements document. The active build order is UC-02 before UC-01; use-case numbering is not implementation order.

Actors:

- Events/Media committee: prepares and publishes an event.
- Visitor: a member or member of the public who registers without logging in.
- Platform: makes published events discoverable, records registrations, and returns an immediate on-page result.

Precondition: a committee has an event, activity, or workshop ready to announce. Trigger: the committee publishes it.

The required public flow is unchanged:

1. The committee publishes title, date, and description.
2. The event appears live on the public events page, without a separate manual post.
3. A visitor opens the event and chooses Register.
4. The registration is written to the platform's core data.
5. The visitor receives an immediate confirmation on that page.

No account or Member row is a precondition for step 3. A confirmation email is not currently required by UC-02; the on-page result is the required confirmation.

## 2. Existing data contract

The following fields already exist in `db/schema.ts` and are the complete approved data set for the basic public flow:

| Record          | Fields used by UC-02                                                     | Rule                                                 |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `events`        | `title`, `description`, `eventDate`, `location`, `committeeId`, `status` | An event is `draft`, `published`, or `full`.         |
| `registrations` | `eventId`, `memberId`, `attendeeName`, `attendeeEmail`, `registeredAt`   | `memberId` is nullable; name and email are required. |
| `committees`    | `id`, `name`                                                             | Provides the event's owning committee.               |

`registrations.memberId` must remain nullable. Do not create a fake Member for an anonymous attendee and do not add an Attendee entity. The future historical-linking flow belongs to UC-01 follow-up work, not UC-02.

`registration_attempts`, backed by `docs/adr/0005-registration-rate-limiting.md`, is technical abuse-prevention data, not a new UC-02 business entity. Its schema and migration are part of the current codebase; do not treat its existence as approval for additional business data.

## 3. Public screens and behavior

### Public events page

Show only currently published events. Each event shows title, date and time (with an unambiguous time zone), description, location when supplied, and a Register control when registration is open.

Drafts are not publicly discoverable. A full event must not accept a normal registration. Public pages must be usable on a phone and must not expose committee ownership, attendee data, drafts, or internal status details.

### Registration form

The public form collects exactly attendee name (required, trimmed, non-empty), attendee email (required and valid), and an event identifier supplied by the page but validated server-side. The server writes `memberId: null`.

The success state says that registration succeeded and remains visible without requiring email delivery. Validation, unavailable-event, full-event, and abuse-protection failures are safe, understandable messages; internal database details are never displayed.

### Event states

| State     | Public visibility                           | Registration               | Committee intent                           |
| --------- | ------------------------------------------- | -------------------------- | ------------------------------------------ |
| Draft     | Hidden                                      | Closed                     | Awaiting review/approval where applicable. |
| Published | Visible                                     | Open                       | Available for normal registration.         |
| Full      | **OPEN: public waitlist behavior required** | Normal registration closed | Capacity reached or manually closed.       |

The original UC-02 exception flow says a full event shows a waitlist option. The current schema has neither capacity nor a waitlist record, so simply showing “full” is not compliant completion of that exception flow. A waitlist data model, ordering rule, notification rule, and personal-data retention rule require a written product decision before implementation.

## 4. Administration dashboard

The dashboard is additional scope recorded in `CLAUDE.md`, not a replacement for the public UC-02 flow. It must have its own internal route/layout and server-side authorization boundary; hiding controls in the UI is not authorization.

Required screens once authorization is approved:

| Screen             | Purpose                                       | Data shown or changed                                                                           |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Event list         | Let a committee find its events.              | Title, date, status, attendee count.                                                            |
| Create event       | Start an announcement as a draft.             | Approved `events` fields only.                                                                  |
| Edit/publish event | Correct details and change publication state. | Approved `events` fields and state transitions.                                                 |
| Registration list  | Manage an event's registrations.              | Attendee name, attendee email, registration time, and later attendance state when UC-03 begins. |

The dashboard must not hard-delete events or registrations (NFR-01). Event edits and state changes must satisfy NFR-02's traceability requirement before the dashboard can be called complete; no audit-log model exists yet.

### Administration decisions that remain open

1. **Committee authorization model:** which authenticated identity and data model establishes that a person can manage a specific committee? UC-01 is deferred and the current schema has no committee-membership/role mapping.
2. **Cross-committee access:** whether any board or technical role can read or edit another committee's events and registrations.
3. **Review workflow:** which role, if any, approves a draft before publish, and whether Events and Media have the same powers.
4. **Registration-data access/export:** which roles may view attendee email and whether export is allowed, including its format and audit trail.
5. **Full and waitlist policy:** capacity source, waitlist ordering, promotion, and notification behavior.
6. **Duplicate registration policy:** whether the same email may register more than once for the same event, and the user-facing result.
7. **Event lifecycle after publication:** permitted edits, cancellation, postponement, and the record shown to prior registrants.

These are product/security decisions, not implementation details. The dashboard may not ship until decisions 1–4 are resolved. The public flow may not claim UC-02 complete until decisions 5–6 are resolved and the documented exception flows are implemented.

## 5. Security and RLS

Public data access follows least privilege:

- An anon visitor may read a published event only.
- An anon visitor may create an anonymous registration only for a published event, with `member_id IS NULL`.
- An anon visitor may not list registrations, members, committees, drafts, certificates, archive records, or mentorship data.
- Attendee email is never public data.

The staging migration and its automated anon-role test implement that minimal policy set on the separate staging project. Production/development RLS and committee authorization are not yet designed; this is a tracked environmental asymmetry, not permission to use a service-role key from the browser. Any production-facing policy ships with an anon-role test proving both an allowed and a denied operation.

Rate limiting may reduce naive spam but does not replace RLS, authorization, or input validation. The staged direct-anon integration bypasses the server-action rate limiter documented in ADR 0005; a public deployment must not claim that limiter protects direct PostgREST writes unless the boundary is changed and verified.

## 6. Error and alternate flows

| Situation                              | Required result                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Missing or malformed registration data | Reject without writing a registration; identify the field safely.                       |
| Invalid or stale event reference       | Reject without exposing internal details.                                               |
| Draft/unpublished event                | Keep it undiscoverable; reject a forged registration request.                           |
| Full event                             | Offer the approved waitlist behavior once designed; never create a normal registration. |
| Repeated attempts / spam               | Apply the approved rate-limit behavior without leaking operational details.             |
| Successful write but lost response     | The registration remains; retry behavior follows the approved duplicate policy.         |
| Email delivery failure                 | Does not undo a successful registration or replace the on-page confirmation.            |

## 7. Acceptance criteria and verification

Public announcement and registration are ready for review only when:

- a published event appears publicly and a draft does not;
- a visitor can register with only name and email, without authentication or a Member record;
- the persisted registration has a null `memberId` and valid attendee data;
- the same-page success state appears after a successful write;
- validation and forged/unpublished/full requests are safely rejected;
- the approved waitlist and duplicate policies are implemented and tested;
- anon-role RLS tests prove both allowed and denied operations;
- mobile browser behavior, lint, type-check, tests, and production build pass.

Administration is ready for review only when the authorization, audit, and privacy decisions in section 4 are resolved; corresponding schema, RLS, server authorization, tests, and documentation ship together.

## 8. Delivery order

1. Keep migrations, Drizzle schema, migration journal, and the intended development project aligned before relying on database changes.
2. Resolve waitlist, duplicate-registration, and event-capacity policy; record any resulting data-model change before coding it.
3. Complete and test the public UC-02 flow against the approved policies.
4. Resolve committee authorization, review, exports, and audit requirements.
5. Add the dashboard with least-privilege authorization and RLS.

UC-01 remains deferred. Nothing here authorizes profile creation, login, historical-registration linking, attendance, certificates, or email delivery beyond the current approved scope.
