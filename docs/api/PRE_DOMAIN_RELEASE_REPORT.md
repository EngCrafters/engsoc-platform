# ESSQU pre-domain release report

Report completion date: October 19, 2026 (Asia/Dubai). This report records verified evidence
and completed pre-domain functional verification. Custom domains, DNS, Auth origins
and production host enforcement remain unchanged. No fake attendee registration
has been written to production.

## Source and project separation

| Component                                       | Evidence                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Core baseline                                   | `15875f4` in `EngCrafters/engsoc-platform`                                                           |
| Core API outcome contract                       | `1eac4db`                                                                                            |
| Core token delimiter and cursor precision fixes | `25c433d`                                                                                            |
| Core shared-fixture CI assertion correction     | `4ca9f82`                                                                                            |
| Core release harness/docs checkpoint            | Main `6e71995`; staging runtime checkpoint `4ca9f82`                                                 |
| Preserved Landing source                        | `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0`; original source/remotes remain clean and unchanged       |
| Separate Landing repository                     | Private `EngCrafters/essqu-web`, PR 1; reviewed integration checkpoint `898870f`, both CI jobs green |
| Separate Landing Vercel project                 | `essqu-web`, `prj_yXxcM8AlVAuARpepUJMUAo4N20AL`, Git-connected                                       |

GitHub identifies `EngCrafters` as a **User** namespace. The owner explicitly
accepted keeping Landing there; this report does not describe it as a GitHub
Organization. Landing production is Ready at `https://essqu-web.vercel.app`, deployment
`essqu-obivj77wp-eng-crafters.vercel.app`, on merge
`8f5c0bffb0cf431c98777bc3d6111f014dd3db7b`; main CI `39161420446` passed.
Final browser integration and actual-secret comparison passed. Core continues to serve
at `https://engsoc-platform.vercel.app`.

## Local validation and defects found

- Full Core unit/disposable-database suite: **421 tests across 44 files passed**.
- Full baseline desktop/mobile Playwright suite: **43 passed, one intentional
  duplicate viewport-matrix skip**. The pinned Chromium executable was installed
  before the successful run.
- After the public cursor fix, the focused public-events browser suite passed
  **8/8**, including period/pagination, event detail, registration and waitlist.
- Format, lint, migration consistency, TypeScript and production builds passed.
- `npm audit --omit=dev --json`: **zero vulnerabilities**.
- OpenAPI validation passed with two nonblocking warnings: license metadata is
  absent because no license decision has been invented; the OPTIONS response is
  intentionally 204 only.

Live preparation identified two runtime defects, both covered by regressions:
underscores in a valid API token secret could confuse a greedy prefix split;
and JavaScript/driver timestamp conversion could discard cursor microseconds.
Core now verifies valid delimiter candidates in a single parameterized registry
query and retains PostgreSQL timestamp precision only in the internal cursor
envelope. Public event objects do not gain an internal cursor-date property.

GitHub Actions run `39160038356` on `25c433d` failed one test assertion, with 419
tests passed and one backup-container test skipped. The precision test assumed
that any page containing a precision fixture must also end in one. Other suites'
fixtures made that false under CI ordering. Commit `4ca9f82` checks the decoded
cursor's own event ID and still requires a precision-fixture cursor to have
been exercised. The full local 421-test suite passed after this test-only fix.

## Hosted staging evidence and protection boundary

Staging database `wnrdgnmmcdedmilnzzsl` has migration 0024 applied through
Supabase MCP. Catalog checks confirmed forced RLS, the routine-owner SELECT
policy, runtime routine execution, no anon/authenticated/PUBLIC routine
execution, zero runtime table grants, and five existing registrations retained.

The Core staging ingress is
`https://engsoc-platform-git-staging-eng-crafters.vercel.app`. Its exact alias
has a Vercel protection exception for the public browser registration/CORS
transport; other preview aliases retain protection, and Core's own API-key and
administrative Auth checks continue to apply. Landing preview protection stays
enabled; a fresh trusted OIDC token is injected only for the exact Landing host.

The Landing staging alias is
`https://essqu-web-git-staging-eng-crafters.vercel.app`. An independent read-only
browser round verified homepage and event-list HTTP 200 in English desktop and
Arabic mobile, correct LTR/RTL, translated empty state, no horizontal overflow,
and no console/page errors or failed requests. Sixty observed HTML/RSC/JavaScript
responses contained no `essq_test_`, `essq_live_`, PostgreSQL connection URL or
service-role markers. This is a marker scan of observed assets, not a claim to
have exhaustively compared every asset against the actual private key.

Screenshots and the safe result summary are in the ignored Landing directory
`artifacts/live-staging-qa/`. No registration POST was made in that independent
empty-state round. Subsequent fixture/read and the completed two-window HTTP/browser matrix are
recorded below and described in [STAGING_HTTP_E2E.md](STAGING_HTTP_E2E.md).

## Completed live staging matrix

Run `7e31d8dd-bea1-4c25-9edc-6d83b93fc046` passed all assertions:

- Read authentication/scope: 401/403/200, exact public DTO and visibility.
- Precise upcoming/past pagination; CORS and validation 400/403/413/415/422.
- All five conflict reasons, confirmed/waitlisted registrations and duplicate outcomes.
- Simultaneous one-seat requests returned 201/409 with exactly one confirmed row.
- Real rate limit 429 and Retry-After 600 across the two verification windows.
- Actual Landing browser confirmation returned 201, with only expected attendee
  fields/intent, no credentials or client IP, request-ID echo, and no automatic retry.
- Four anonymous successful registration audit outcomes reconciled. Cleanup left
  zero fixtures and retained the five original staging registrations.

The scope-denial staging canary was revoked; the intended staging read client is
retained for the preview. The production scope-denial canary was also revoked.

## Live production Auth/admin boundaries

Sixteen read-only responses were checked on the current Core production alias:

- `/admin/login`: 200 and the sign-in form; hidden return path `/admin/events`.
- `/admin/recovery`: 200, the reset-password page and account-neutral guidance.
- `/auth/reset`: 200, signed-out “Reset link unavailable” state, no password input.
- `/admin/access`: 307 to `/admin/login?next=/admin/events` without a session.
- Four URL-encoded foreign absolute, protocol-relative and backslash return-path
  variants on login, callback and protected access stayed internal. Login
  sanitized its hidden return path to `/admin/events`; callback returned 307 to
  `/admin/events`; protected access retained its safe sign-in redirect.

All sixteen responses carried CSP, `nosniff` and `X-Frame-Options: DENY`.
The baseline-to-current diff for `lib/auth`, `app/admin`, `app/auth`, the origin
guard and `proxy.ts` was empty. A successful production runtime-log query for
error/fatal entries over the inspected 30-minute window returned no entries.
That is bounded log evidence, not proof that errors never occur.

No fresh real-credential sign-in, authenticated admin pilot, sign-out, emailed
recovery or completed password reset was performed in this pass. Existing local
Auth boundary tests and earlier historical pilots do not substitute for those
fresh production flows. No recovery email was sent and no user was mutated.

## Production migration risk acceptance and checks

Production `rbeyqrfypowyocmnmvwu` retained seven registrations. All ten application
tables had ENABLE/FORCE RLS; `app_runtime` had zero application-table grants and
NOBYPASSRLS. The existing public catalog contained one upcoming and two past
events; these are observed records, not new smoke fixtures.

The Supabase organization is Free. Authenticated backup inspection returned
`backups: null`, `physical_backup_data: {}`, `pitr_enabled: false` and
`walg_enabled: true`. **No usable managed backup is claimed.** The owner explicitly
accepted that risk only for the exact unchanged additive migration 0024 after
successful live staging and concurrency checks. The waiver authorizes no other
DDL, existing-row DML, local dump/PII export, subscription upgrade, DNS/domain or
Auth change. No local production attendee export has been taken.

Independent review confirmed migration file byte identity at `15875f4` and
`1eac4db`, with SHA-256:
`cab56a820213bf11bca3f72d0581ed3505b509de8886e66837446c81b5de5479`.
The file adds the private registry table, owner SELECT policy and verification
routine with scoped ownership/RLS/grants; it contains no destructive DDL or
existing-row mutation. The exact routine must be absent before applying its
`CREATE OR REPLACE FUNCTION` statement.

The repository file has no explicit transaction wrapper. The completed MCP request
contained `BEGIN;`, that unchanged file, and `COMMIT;`, with no extra DDL or
migration. The final SQL self-check is limited to registry runtime table grants,
runtime execution and PUBLIC execution. The operator separately compares
pre/post row counts, existing forced RLS and grants, registry owner/policy,
routine SECURITY DEFINER/search path and all execution privileges. See
[PRODUCTION_CUTOVER_RUNBOOK.md](PRODUCTION_CUTOVER_RUNBOOK.md) for the checklist.

## Production activation record

- Production 0024: applied version `20261018200028` (October 18 UTC), exact
  transaction envelope after seven prechecks; all postflight checks passed.
  Eleven application tables have forced RLS; routine owner/policy/search path and
  execution grants are correct, with zero direct/effective runtime table privileges.
  Seven registrations retained fingerprint `d6768a9e715e9e9fb4a43f63b5616214`;
  `register_for_event` retained fingerprint `54ffeccd2ed187f21f420be46e95c17f`.
- Production client `ESSQU Landing Production`: active, production environment,
  `events:read`; key installed as a Landing Production Secret. No privileged
  database/admin variable is present in Landing. Neither raw token nor hash is recorded.
- Core main `6e71995`, CI `39160613952` passed; production alias
  `https://engsoc-platform-59x8jkk42-eng-crafters.vercel.app` serves
  `https://engsoc-platform.vercel.app`, deployment ID
  `dpl_F5pTn1aWz6rudnq9nyTy5J9pgVeH`.
- Landing PR 1 merged as `8f5c0bffb0cf431c98777bc3d6111f014dd3db7b`, main CI
  `39161420446` passed; Ready deployment `essqu-obivj77wp-eng-crafters.vercel.app`
  serves `https://essqu-web.vercel.app`, deployment ID
  `dpl_4Kj8rku9wS9iUUKdTwCHsaRcPU8M`.
- Production API: missing/bogus credential 401, active wrong-scope 403, valid list
  200 with one upcoming event, valid detail 200 for existing public event
  `64146dfc-d238-40cc-a4af-6e761fd4e738` (“Engineering Society Networking Evening”).
  Bogus credential changed from 503 before migration to 401 after. Canary
  revocation returned 401 immediately without a deploy.
- Temporary exact Landing origin `https://essqu-web.vercel.app`: preflight 204
  with matching allow-origin; foreign preflight 204 without allow-origin.
- Representative valid API GET: 1125 ms; single observation, not a benchmark.
- Final production browser QA passed in English/Arabic on desktop/mobile: 16
  main-route responses plus four detail responses were 200, showing the actual one
  upcoming and two past events, correct LTR/RTL and no horizontal overflow.
- In-memory exact-secret scanning was enabled. It checked 358 loaded HTML/RSC/JS
  responses and observed request URLs/headers, storage and cookies with zero
  violations. Twenty canceled-prefetch bodies were separately unreadable; no
  scans remained pending. No actual credential is printed or recorded.
- Each of the four production browser scenarios had zero read-only console, page
  or HTTP errors. Four registration requests were intercepted and aborted before
  network; each carried only expected fields/intent, no credential/cookie/IP, and
  a request ID. Generic unavailable guidance appeared and there was no retry
  during the observed 1.2-second window. Production writes remained zero.
- Staging already proved the real browser confirmed-201 flow. Production
  registration writes were deliberately not attempted. The secure QA wrapper
  exited zero; the earlier helper assertion was resolved without a product change.
- A later production recheck retained all seven registrations and the same
  fingerprint. Landing runtime error logs returned zero records in the inspected
  15-minute window. The original teammate checkout SHA/status/remotes remained unchanged.
- A final five-minute Vercel request-log query for HTTP status >=500 returned
  zero records for both Core and Landing. The production recheck retained zero
  runtime table grants, one active intended events-read client and one revoked
  canary. These are bounded observations, not an availability guarantee.
- Vercel project-domain inspection listed only `engsoc-platform.vercel.app` and
  `essqu-web.vercel.app`; no ESSQU custom domain is attached. Provider-managed
  Vercel Secrets remain authoritative; no plaintext `.env` key file was created.

Custom-domain cutover remains a separate future operation governed by
[CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md](CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md). Preserve the
working Vercel aliases and existing Auth origins while that work remains deferred.

## Post-migration advisor findings

The production security advisor returned four informational RLS-with-no-policy
findings on intentionally dormant default-deny tables: `members`, `certificates`,
`archive_items` and `mentorship_connections`. No API registry finding appeared.
Do not add public policies to those future-use tables to remove informational findings.
The existing Auth warning is disabled leaked-password protection. See
[Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
for enabling the protection when the owner chooses; no unrequested Auth setting
or subscription change was made in this release.

## Completion and deferred follow-ups

Pre-domain functional verification is complete. The final documentation commit
and its delivery evidence are recorded separately when available; no future SHA
is invented here. Custom-domain/DNS/Auth-origin and host-enforcement cutover is
not performed. Existing nonrelease follow-ups remain explicit:

- Fresh real-credential production sign-in/sign-out and emailed recovery/reset
  pilots were not repeated in this pass; signed-out boundaries and safe redirects
  were verified instead. No recovery email or user mutation was triggered.
- Leaked-password protection remains disabled with the existing advisor warning;
  no Auth setting or subscription upgrade was made without a separate decision.
- Development-only dependency advisories remain documented follow-ups; zero
  production-runtime advisories does not imply a clean development-tool audit.
- No usable backup is claimed. Owner risk acceptance applied only to exact 0024,
  and creates no precedent for later production migrations or PII exports.

Provider-managed Vercel Secrets are authoritative. No plaintext key files were
created. Temporary encrypted staging and production operator state was removed
after final verification; both exact state paths were checked absent. Provider
Vercel Secrets remain authoritative. The local operational helpers contain no
raw credentials and require fresh provisioning before future credential checks.
