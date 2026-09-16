# UC-02 acceptance criteria, tests, and delivery plan

Revision 3, September 15, 2026. Behavior:
[deep dive](UC-02_Deep_Dive.md). Fields/security:
[data contract](UC-02_Data_and_Security.md).
**O-01 answered September 15, 2026 (per-committee two-manager review); freeze
confirmed once this commit is pushed and CI is verified green (deep dive
section 15).**
Test definitions below are requirements, not claims of implemented coverage.

## 1. Acceptance criteria

Each row is a behavior assertion. U = unit, D = real PostgreSQL database,
R = real anon/authenticated role boundary, S = server/action integration,
C = component, E = Playwright browser. Tests may cover multiple IDs; do not
duplicate the same assertion at every layer without a reason.

| ID  | Given / when / then                                                                                                                                                               | Required layers  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| A01 | Given an authorized committee and valid draft, when created, only that committee can see it; database defaults and audit are present                                              | D/R/S            |
| A02 | Given an approved publishable event, when published, the next public request lists it and detail page offers same-page registration, without rebuild                              | D/S/E; O-01      |
| A03 | Given draft/archived/missing IDs, when an anon browses or submits forged IDs, all are unavailable and no private details/entry are returned                                       | R/S/E            |
| A04 | Given a published future event, when a visitor submits name/email, exactly one confirmed row exists with memberId null, attended false and checkedInAt null                       | D/S/E            |
| A05 | Given successful persistence, when response renders, same-page confirmation appears; no account/Member/email dependency exists                                                    | S/C/E            |
| A06 | Given empty/whitespace/oversized/control-character names, malformed/oversized emails, bad intent/UUID, when submitted, safe field errors occur without registration writes        | U/D/S/C          |
| A07 | Given Arabic, apostrophes, hyphens or Unicode names, when validly submitted, original normalized identity is retained                                                             | U/D/E            |
| A08 | Given an active normalized event/email, when case/whitespace variants retry with a different name, no new row or identity overwrite occurs                                        | U/D/S/E          |
| A09 | Given the same email on a different event, when eligible, it creates a distinct registration                                                                                      | D                |
| A10 | Given plus-tag/dotted addresses, when submitted, only trimming/case normalization equates addresses; no provider alias collapse                                                   | U/D              |
| A11 | Given two simultaneous requests for the same event/email, when both run, one row exists and outcomes are success/duplicate                                                        | D/S              |
| A12 | Given one remaining seat and two different emails, when concurrent requests run, exactly one confirms and the other returns full with no silent waitlist entry                    | D/S              |
| A13 | Given unlimited capacity and no manual hold/queue, when distinct valid visitors register, no arbitrary event capacity rejects them                                                | D                |
| A14 | Given capacity reached or manual full, when browsed, the event remains discoverable with explicit waitlist option; normal submission creates no entry                             | R/S/E            |
| A15 | Given explicit waitlist consent on a full future event, when submitted, one waitlisted row exists, no seat is consumed, and success says no place is confirmed                    | D/S/C/E          |
| A16 | Given a waitlisted email, when any intent is retried concurrently, only one waitlisted row exists with a safe duplicate outcome                                                   | D/S              |
| A17 | Given the event reopened and queue empty, when a stale join_waitlist form submits, it returns registration available without silently confirming                                  | D/C              |
| A18 | Given a pending FIFO queue and increased capacity, when a new visitor submits, the queue retains priority and normal registration cannot jump it                                  | D/S              |
| A19 | Given the first waitlisted entry and spare capacity, when an authorized manager attests contact and promotes, the same row confirms with one audit and unchanged identity/time    | D/S/E            |
| A20 | Given a later queued person, full/manual-held/past event or no contact attestation, when promotion is attempted, it is denied without a seat/audit mutation                       | D/S              |
| A21 | Given concurrent promotions or promotion/registration, when competing for capacity, no extra seat or duplicate audit results                                                      | D/S              |
| A22 | Given a past event (including exact start), when discovered, it is visible in past events but new registration/waitlist/promotion is closed                                       | U/D/E            |
| A23 | Given a transaction waiting over start time, when it finally locks the event, admission uses the post-lock clock and rejects new registration                                     | D                |
| A24 | Given confirmed/waitlisted identity already stored for a visible past event, when retried, a safe duplicate result appears without new writes                                     | D/S              |
| A25 | Given six simultaneous attempts from one canonical IP in ten minutes, when processed, at most five pass the limiter and all parsed attempts are recorded                          | D/S              |
| A26 | Given different events/intents but the same IP, when attempts accumulate, they share one limit; different IPs remain independent                                                  | D                |
| A27 | Given spoofed/missing/malformed production IP, oversized request or cross-origin POST, when submitted, the boundary rejects it without admission                                  | S/E              |
| A28 | Given raw anon/authenticated PostgREST, when attempting registration INSERT, member attachment, attendance flags, timestamps, status, UPDATE or DELETE, all writes fail           | R                |
| A29 | Given raw public event SELECT, when requesting private columns or joined attendees, the request cannot expose ownership or PII                                                    | R                |
| A30 | Given manager A and committee B, when A guesses B's event/registration IDs for list/edit/publish/promotion/export, every operation is denied without data                         | R/S/E            |
| A31 | Given a grant revoked while a session remains valid, when the next operation occurs, it is denied; an operation already holding the grant lock finishes before revocation commits | D/R/S            |
| A32 | Given user-editable role metadata or a forged actor/committee form field, when used to gain privileges, no access is granted                                                      | R/S              |
| A33 | Given a real authenticated user with no grant, when opening admin, no committee data is shown; login does not create a Member                                                     | R/S/E            |
| A34 | Given an expired session or unsafe return URL, when login/action/reset is used, identity is verified and redirects stay on allowed internal paths                                 | S/E              |
| A35 | Given two edits with the same revision, when saved, one succeeds and the other gets CONFLICT without overwriting                                                                  | D/S/E            |
| A36 | Given registrations and a racing capacity edit, when capacity falls below confirmed count, it is rejected; increases preserve queue order                                         | D/S              |
| A37 | Given any entry, when event date/owner is changed or event is withdrawn to draft, it is denied; permitted corrections are logged                                                  | D/S              |
| A38 | Given draft/past event, when archived/restored, records and registrations remain intact and public visibility follows the lifecycle                                               | D/R/E            |
| A39 | Given future published event, when archive/cancel/delete is forged, unsupported or forbidden operations cannot remove it or its entries                                           | D/R/S            |
| A40 | Given any domain mutation, when its audit write fails, the domain change rolls back; repeated no-op promotion adds no mutation audit                                              | D                |
| A41 | Given anonymous creation/import, when audited, it has honest actor kind rather than fabricated user attribution; raw IP absent                                                    | D                |
| A42 | Given multiple registration pages, when navigating cursor pages with tied timestamps, stable order and parent scope hold; invalid cursor/limits fail                              | U/D/S/E          |
| A43 | Given event/status-scoped export, when downloaded by its manager, all matching snapshot rows appear, no foreign/extra fields, audit exists                                        | D/S/E            |
| A44 | Given formula-like name/email, quotes/newlines/Unicode, when exported, UTF-8 CSV is valid and cells cannot become executable formulas under the documented encoding               | U/S              |
| A45 | Given export threshold exceeded, audit failure or DB failure, when downloading, no truncated successful file or PII error is returned                                             | D/S              |
| A46 | Given changing registrations during export, when downloaded, one consistent snapshot/count is used; download is private/no-store                                                  | D/S              |
| A47 | Given DB failure during list/read/submit, when UI renders, it shows retry/error rather than empty/success; logs have no PII/SQL secrets                                           | S/C/E            |
| A48 | Given response lost after commit, when the visitor retries, there is one permanent entry and safe duplicate response                                                              | D/S/E            |
| A49 | Given phone width 320/375px, keyboard or screen reader, when navigating/forms submit, labels/focus/errors/pending/success are accessible without page overflow                    | C/E              |
| A50 | Given app dates and a device outside Oman, when rendering/editing, time stays explicit Asia/Muscat and UTC instants round-trip correctly                                          | U/E              |
| A51 | Given null memberId, when admin lists/exports an entry or later certificate identity is derived, captured identity remains available with no required Member join                 | U/D/S            |
| A52 | Given attempts older than one hour, when maintenance runs, technical rows expire while permanent domain/audit history remains                                                     | D                |
| A53 | Given known synthetic duplicate fixtures, when migrating, earliest active entry survives and all duplicate rows remain superseded with audited links                              | D                |
| A54 | Given ambiguous duplicates or invalid legacy details, when preflight runs, migration stops with an aggregate diagnostic and no fabricated replacement data                        | D                |
| A55 | Given fresh DB or already-staged history, when forward migrations run, schema/index/policy/routine/journal outcomes agree                                                         | D/R              |
| A56 | Given every UC-02 action, when Resend registration email is unavailable, public results are unchanged and no event mail is attempted                                              | S                |
| A57 | Given required review or invalidated approval, when publish/reopen is attempted, policy follows finalized O-01 with positive, wrong-actor and stale-revision tests                | D/R/S/E; blocked |
| A58 | Given application runtime DB credentials, when invoking raw DML, maintenance functions or role escalation, all are denied; allowed fixed routine still works                      | D                |
| A59 | Given actual deployed main commit, when tested through authorized tooling, public list/detail render from the intended DB and admin session boundaries hold                       | E/runtime        |
| A60 | Given backup and isolated restore, when recovered, events/entries/grants/audit and RLS remain intact with no production writes                                                    | D/operations     |

## 2. Security boundary coverage

These pairs are mandatory, even when business operations have unit tests.
Use actual anon and authenticated clients/JWTs; setup authority never counts
as an authorization assertion. No private production fixtures.

| Boundary                  | Positive assertion                                       | Negative assertion                                                       |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Public event rows/columns | Read safe fields of published/full event                 | Draft/archive/private column inaccessible (A03/A29)                      |
| Anonymous write route     | Valid action persists accountless entry                  | Raw API and private routine cannot bypass limiter (A04/A28/A58)          |
| Capacity lock             | Last eligible place confirms                             | Competing seat is denied; post-start lock wait denied (A12/A23)          |
| Email uniqueness          | Different event/email can register                       | Same normalized event/email concurrent insert cannot duplicate (A08–A11) |
| Auth identity             | Provisioned manager sees own committee                   | Invalid/no-grant/forged metadata denied (A30–A34)                        |
| Manager scope             | Own events/registrations/export visible                  | Other committee rows/joins/counts absent (A30)                           |
| Membership table          | User can read own grants                                 | Cannot read others or self-grant/reactivate (A31/A32)                    |
| Waitlist                  | Explicit joining and first-person promotion work         | Queue jump/capacity bypass/member attachment denied (A15–A21/A28)        |
| Audit                     | Authorized mutation creates one audit                    | Runtime rewrite/delete denied; failed audit aborts change (A40/A58)      |
| Private bookkeeping       | Trusted limiter records and job expires attempts         | anon/auth cannot read IPs or reset limiter (A25/A52/A58)                 |
| Future tables             | Authorized maintenance can verify fixture presence       | anon/auth cannot read or mutate Member/Certificate/Archive/Mentorship    |
| Export                    | Own scoped snapshot downloads                            | Cross-scope, formula execution and partial failure blocked (A43–A46)     |
| Publication approval      | Different-manager approval at current revision publishes | Self-approval, stale-revision, or unresolved review denied (A57)         |

For future-scope tables, the positive control uses fixture existence under
maintenance authority only to prove the negative query isn't testing an empty
table. It does not claim an in-scope user permission.
Every table gets INSERT/UPDATE/DELETE denial tests in addition to SELECT tests.
Test default function EXECUTE grants and private-schema exposure explicitly.

## 3. Test implementation plan

- Unit (Vitest): pure validators, normalization, derived availability, result
  mapping, date conversion, pagination parsing, CSV escaping. Avoid snapshots
  that merely duplicate implementation literals.
- Database integration: disposable PostgreSQL matching deployed major version,
  migrated schema, isolated fixtures. Real separate connections coordinated by
  barriers test races; no mocked counts or timing-only sleeps as proof.
- RLS: actual anon/authenticated JWT clients for API grants/policies; SQL roles
  for runtime/executor denial tests. Two committees, two managers, one multi-
  committee user, one no-grant user, one revoked grant. Identity setup/cleanup
  stays outside assertions.
- Server/action: malformed FormData/File/multiple fields, spoofed headers,
  typed error translation, unknown commit, session validation, per-operation
  authorization, no public private DTOs.
- Component: labels, field errors, focus, pending, explicit waitlist opt-in,
  and closed/retry/duplicate states.
- Playwright: discover -> detail -> inline confirmed/duplicate/waitlisted;
  own/foreign committee admin; CSV; session expiry; mobile/timezone; database
  failure handling. Use a test environment, not live real attendees.
- Runtime: deployed commit and serving database verified, protected deployment
  accessed using authorized tooling, console/server errors inspected. Keep
  public browsing read-only against production; synthetic mutations run only
  in an approved test environment.

### Reproducible concurrency schedule

Create a future published event with capacity 1 and zero confirmed.
Connection A begins and holds the event row lock. Start B and prove it waits.
A inserts/audits/commits; B resumes and must observe the new count in its
post-lock statement. Assert one confirmed and B full. Repeat with A rollback,
same email, promotion, capacity reduction, and clock crossing start time.
Close all connections and restore fixtures even on assertion failure.
Measure a bounded run (e.g. 20 concurrent clients) to detect unbounded lock
waits; correctness is exact counts/outcomes, not a speculative throughput SLA.

## 4. Dependency-ordered implementation milestones

No milestone M1+ starts before M0 is complete. Each implementation milestone
ends with self-review, relevant checks, coherent main commit/push, CI and Vercel
inspection. DB-dependent code activates only after the serving DB is ready.

| Milestone                              | Prerequisites                                 | Exact scope / implementation area                                                                                                                            | Schema / RLS                                                                                 | Tests / done                                                                                              |
| -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M0 Specification freeze                | O-01 owner answer                             | Finalize approval model, reconcile all three specs/ADR, review all checklist items                                                                           | Documentation only                                                                           | No unresolved required behavior; docs formatted, committed, pushed, CI green                              |
| M1 Environment and migration rehearsal | M0                                            | db tooling and test setup: map staging/serving DB, inventory histories/grants, backup/restore rehearsal, isolated test fixtures, forward migration preflight | No production changes; document historical 0002 adoption                                     | A54/A55/A60 preflight proof; credentials permit safe test lifecycle                                       |
| M2 Atomic data/security foundation     | M1                                            | db/schema.ts, generated forward migration/snapshot/journal, private routines, grant/audit/attempt maintenance, complete approved approval model              | All contract fields, CHECKs, indexes, duplicate preservation, runtime roles and RLS together | A01/A03/A06/A08–A13/A20–A32/A35–A41/A52–A58 on fresh and staged upgrade; no exposed new unprotected table |
| M3 Public server boundary              | M2; compatible serving DB or gated activation | db server-only client, lib/events and lib/registrations, thin action adapter; replace direct privileged queries                                              | Use M2 restricted runtime/routines; no new schema                                            | U/D/S public results, clock/races/retries/headers/PII; old bypass path denied; modules documented         |
| M4 Public experience                   | M3                                            | marketing list/past/detail, accessible inline form, explicit waitlist, errors/timezone/pagination                                                            | None                                                                                         | A02–A05/A07/A14–A18/A22/A42/A47–A50; mobile E2E; metadata/DTO review                                      |
| M5 Admin identity and scope            | M2, configured Auth, named test managers      | server-only auth and request-scoped clients, admin login/logout/reset, deny unassigned users                                                                 | Existing grant/routine predicates; no new Member model                                       | A30–A34/A58; actual JWT scope/revocation and no public signup                                             |
| M6 Event management and approval       | M5                                            | scoped event list/create/edit/publish/review/full/reopen/archive/restore; optimistic revisions                                                               | M2 approved O-01 design; no exploratory fields                                               | A01/A02/A30/A35–A41/A57; no foreign committee access                                                      |
| M7 Registration operations             | M6, M3                                        | scoped cursor lists/counts, FIFO contact-attested promotion, private CSV and export audit                                                                    | Existing M2 objects; no extra attendee PII                                                   | A19–A21/A30/A42–A46/A51; concurrency and formula injection tests                                          |
| M8 UC-02 release/closure               | M4–M7                                         | complete role/E2E matrix, backup evidence, actual deployment runtime, docs consistent                                                                        | Serving DB RLS verified via authorized production procedure                                  | All A IDs pass; no owner/security blocker; no missing required flow; next use case chosen explicitly      |

M2 is an atomic database contract commit because granting a partial write path
would break invariants. Domain/UI work thereafter remains small coherent
commits. M3/M4 and M5/M6 may be developed sequentially in either dependency-safe
order; no split-repository implementation.

## 5. Quality and release gates

Repository commands: npm run lint; npm run typecheck; npm run test;
npm run build; npx drizzle-kit check --config drizzle.config.ts.
Use Prettier on changed docs and git diff --check. Add future database/E2E
commands when their test runners are implemented; do not claim they exist now.
CI must require the applicable new suites before UC-02 completion.

Real environment prerequisites:

- Confirm which DB serves Vercel production; staging is explicitly
  wnrdgnmmcdedmilnzzsl, main project rbeyqrfypowyocmnmvwu.
- Current main-project RLS disabled is a blocker to public release.
- Production schema cutover needs its authorized procedure; development
  migration permission does not authorize production mutation.
- Set the restricted runtime connection independently from migration credentials.
- Provision actual committee managers only from owner assignments; fixtures
  must not become real production grants.
- Verify Auth delivery/invitation/reset, trusted origin/IP topology, attempts
  cleanup, backup schedule and an isolated restoration.
- Verify Vercel build and application runtime at the pushed SHA; SSO redirects
  are deployment protection, not evidence of event/registration functionality.

## 6. Completion evidence ledger

At this checkpoint: source PDFs/diagrams, code, migrations, staging schema/RLS
and main-project RLS were inspected. No new application code or migration
has been created. Existing tests cover only the historical staging policy.
All new acceptance tests above remain TO IMPLEMENT.

**Freeze evidence:** owner O-01 answer recorded September 15, 2026
(per-committee two-manager review, deep dive section 11); final specification
commit `9c5b7330ac0af49ce316c6631f1dcbc0902e650b`; CI run verified green:
https://github.com/EngCrafters/engsoc-platform/actions/runs/34987629797;
cross-document consistency review completed (deep dive section 15). This
closes M0.

**M1 evidence (September 15, 2026):** environment map confirmed staging
(`wnrdgnmmcdedmilnzzsl`, 3 migrations applied, RLS + 2 policies, 4 events / 11
registrations / 1 committee) and main (`rbeyqrfypowyocmnmvwu`, 2 migrations
applied, RLS disabled on all 8 tables, 0 rows everywhere — confirms the
existing release blocker, not a new one). A54/A55/A60 preflight proof
recorded in the data/security contract §10. Two follow-ups resolved the same
day: local `.env.local` repointed at staging for `NEXT_PUBLIC_SUPABASE_*`
(main's `DATABASE_URL`/service role kept, clearly labeled, for deliberate
migration work only); the RLS test suite's accumulated fixture rows purged
from staging (12 rows deleted) — and, as of M2 below, that leak cannot recur
at all, since anon can no longer write to `registrations` by any path.

**M2 evidence (September 16, 2026):** schema/security foundation committed
as migrations `0003_uc02_security_foundation_schema` (Drizzle-generated:
`committee_managers`, `private.uc02_audit`, the O-01 event columns,
registration status/supersededBy, all CHECK constraints and indexes) and
`0004_uc02_security_foundation` (hand-written: `app_runtime`/`app_maintenance`/
`uc02_routine_owner` roles; revoked the M1-identified platform-default
anon/authenticated grants; narrow explicit grants; RLS policies retiring
ADR-0006's anon INSERT and adding committee-scoped authenticated policies;
8 `SECURITY DEFINER` routines covering registration, review/approval,
publish/hold/archive/restore, and FIFO promotion). Both migrations were
rehearsed twice on disposable local Postgres 17 containers (schema
convergence, then full role/RLS/routine behavior — capacity, waitlist,
duplicate, self-approval-denial, and the complete O-01 flag→approve→publish
sequence all verified with real role-switching before touching staging).
Applied to staging via the Supabase MCP `apply_migration` tool; two real
bugs surfaced only there (Supabase's `postgres` role isn't a superuser, so
transferring function ownership needed explicit role membership and CREATE
privilege on the `private` schema) and are now fixed in the committed
migration and confirmed by an identical clean rehearsal. Placeholder role
passwords were rotated immediately on staging (never committed). The
existing `tests/rls-staging-anon.test.ts` was updated for D07 (anon INSERT
retired; two additional assertions now correctly expect `42501` since the
M1-finding default grants are revoked, not just narrowed by RLS) and passes
8/8 against live staging. `lib/registrations` was updated to translate the
new partial-unique-index violation into `already_registered` instead of
crashing (M2 changed database behavior that pre-existing app code didn't
anticipate). Lint, typecheck, `drizzle-kit check`, and production build all
pass. Main was not touched. This closes M2's atomic database contract; M3
(public server boundary) wires `lib/events`/`lib/registrations` to call
these routines through `app_runtime` instead of the direct privileged
connection.

**M3 implementation evidence (September 16, 2026):** public event reads now
use the Supabase anon client and therefore remain subject to the public RLS
projection; registration writes now use `private.register_for_event` through
`APP_RUNTIME_DATABASE_URL`, with no direct table DML path in the application.
The forward routine hardening migration adds the transaction advisory lock and
database-owned five-attempt rolling limit. The server action validates the
trusted IP shape, passes the explicit waitlist intent, and maps stable routine
codes to safe UI results. Local lint, type-check, unit tests, Drizzle history
check, and production build pass. Deployment remains gated on configuring the
restricted runtime credential in the serving environment and applying the
forward routine migration there through the approved database procedure.

**Staging follow-up (September 16, 2026):** `0005` was applied to staging
after Supabase MCP OAuth was reauthorized. A freshly rotated staging
`app_runtime` credential was tested through the shared transaction pooler:
it authenticated as that role, could not directly read `events`, and could
execute only the fixed registration routine (a non-existent event safely
returned `EVENT_NOT_FOUND`). No credential is recorded in source, logs, or
this document. The serving main database remains intentionally unchanged.

**Serving-environment cutover (September 16, 2026):** after confirming it
contained zero events and registrations, main received the UC-02 forward
migration chain (`0003` through `0006`). `0006` closes the historical
staging/main RLS gap by enabling and forcing RLS on every domain table.
`app_runtime` was immediately rotated to a fresh secret and independently
verified through the transaction pooler: it cannot directly read events or
insert registrations, but it can execute `private.register_for_event` and
receives the safe `EVENT_NOT_FOUND` result for an unknown ID. The credential
is production-only in Vercel and never recorded in source. The redeployed
production URL returned HTTP 200; an unknown event route returned HTTP 404.
The main event catalog is intentionally empty, so no production attendee or
registration mutation was made during this verification.

**M4 public experience evidence (September 16, 2026):** the public list now
links each event to a dynamic `/events/[id]` detail page with Muscat timezone
formatting, accessible registration copy, and explicit register/waitlist
submit intents. Unknown or non-public IDs resolve through the same public
not-found boundary. The routine contract returns `REGISTRATION_AVAILABLE` when
a stale waitlist action is submitted after capacity reopens. Local lint,
type-check, unit tests, and production build pass; browser E2E remains in the
planned test matrix and runtime registration remains gated by the serving
database credential/migration prerequisites above.

Implementation completion must still record the migration versions per
environment, runtime role test results, app/CI/deployment SHA, E2E results
and any independently blocked release action. Never mark a blanket-deny
policy as completion of an intended allow behavior.
