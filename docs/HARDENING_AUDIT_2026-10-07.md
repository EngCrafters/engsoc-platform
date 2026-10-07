# Pre-expansion hardening audit — October 7, 2026

Status: **Lifecycle validated and production migration applied; deployment and real Support pilot pending**.
The broad repository audit is complete. The production evidence below supersedes
the earlier unavailable-access findings. The lifecycle extension reuses the existing access UI; no broad appearance change or business data deletion is included.

## Boundary and evidence

- Current access authority is ADRs 0012/0014, `ACCESS_CONTROL.md`, and the live
  `administrative_access` database model. ADR 0009 and the manager-only UC-02
  sections are historical.
- The 0022 migration repairs committee RLS to read real Supabase
  `request.jwt.claims`; the database suite exercises Technical, Board, Manager,
  no-access and anonymous roles with PostgreSQL grants/RLS, not only UI hiding.
- The database test setup replays every migration into disposable PostgreSQL
  17 and checks direct DML denial, private routine grants, committee scope,
  event lifecycle, registration concurrency, audit and backup/restore paths.
  No historical migration was edited during this audit.
- Public registration and administrative event/registration paths use fixed
  private routines through `app_runtime`. Caller identity comes from Supabase
  Auth; direct browser table writes and attendee PII reads are denied. The
  Technical-only Auth Admin API remains server-only in `lib/auth/admin.ts`.
- The local staging anonymous RLS test and the browser suite exercise real
  public/unauthenticated boundaries. The production closure evidence below records
  live database inspection and distinguishes it from interactive sign-in tests.

## Changes made

| Finding                                                                                               | Impact                                                                                                                                                      | Resolution                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js 16.3.4, Sharp 0.35.4 and source-map-js 1.2.1 had production dependency advisories             | The Next.js RCE advisory requires a `next/og` route with attacker-controlled SVG content, absent here; retaining vulnerable packages still adds future risk | Patched Next.js to 16.3.6, Sharp to 0.35.5 and source-map-js to 1.2.2; production dependency audit now has zero advisories                                         |
| Responses lacked explicit clickjacking, MIME-sniffing and referrer protections                        | Browser-side defense in depth was incomplete                                                                                                                | Added narrow CSP frame/base/object directives, X-Frame-Options, X-Content-Type-Options, no-referrer and Permissions-Policy; retained Vercel's stronger HSTS header |
| Technical temporary-password action used the first `FormData` value and asserted it was text          | Duplicate/file values could bypass the action's intended single-value parsing                                                                               | Requires exactly one string, preserves password whitespace and adds a regression test                                                                              |
| An unused helper exported a service-role Supabase client                                              | Future ordinary runtime imports could bypass RLS accidentally                                                                                               | Deleted the unreferenced helper and corrected README architecture                                                                                                  |
| Five stock starter SVGs had no references                                                             | Unused template assets obscured the actual brand assets                                                                                                     | Removed only the traced unreferenced starter files; retained the Engineering Society logo and user-managed artifacts                                               |
| Auth Admin API audit failures were silently swallowed                                                 | Operators could miss a completed Auth change with no database audit label                                                                                   | Emits a secret-free `auth_admin_audit_failed` log for reconciliation; external Auth and PostgreSQL cannot be one atomic transaction                                |
| Format gate scanned user-managed untracked artifacts; CI omitted format, migration check and browsers | Local gate failed on an untracked template, while CI did not repeat all core checks                                                                         | Format checks tracked files only; CI now runs format, migration consistency and Playwright browser tests                                                           |
| Current docs mixed Mailtrap and manager-only history with the live hierarchy                          | An operator could follow obsolete access or email instructions                                                                                              | Marked historical contracts, updated current Resend operations and added failure/backup procedures                                                                 |

The first clean CI browser build revealed that the test setup had relied on a
local `.env.local` value for `APP_RUNTIME_DATABASE_URL`. The Playwright setup now
passes its disposable restricted database URL to both the build and running app;
it uses no production credential.

## Production closure evidence - October 7, 2026

### Credential incident: corrected classification and closed rotation

**High, remediated.** The original report incorrectly called the exposed
`DATABASE_URL` a staging credential. Inspection of the ignored file, its
pre-incident modification time, project identity, and a real connection proved
it was the **production postgres migration credential** for
`rbeyqrfypowyocmnmvwu`. The staging `APP_RUNTIME_DATABASE_URL` was a different
credential and was not rotated unnecessarily.

- Rotated through Supabase's supported database-password Management API (HTTP
  200). A new connection succeeded; the old credential failed with SQLSTATE
  `28P01`. Values were kept out of the rotation command output and repository.
- Updated `.env.local` and the matching Vercel Development `DATABASE_URL`.
  Removed the unused Preview `DATABASE_URL`; production has no such variable
  and uses its separate restricted `app_runtime` connection.
- GitHub repository secret inventory was empty; CI uses disposable PostgreSQL
  and public staging anon credentials. Neither supported Supabase CLI project
  credential entry existed. A scan of 824 reachable Git blobs found no exposed
  credential match. Other owner-managed stores outside the inspected environment
  are not claimed to have been inventoried.
- Reviewed production and staging logs over 2026-10-06 18:00 through the current
  2026-10-07 inspection window. The observed production pooler authentication
  failure matched the deliberate old-password test. Production permission
  failures matched attempts to assume the restricted runtime role; staging
  permission failures accompanied anonymous security tests. No suspicious
  activity was identified in this evidence. Connection/disconnection logging
  is off, statement logging is DDL-only, and pgAudit is disabled, so this is
  not proof that every historical connection or read was benign.

### Production database and data: verified read-only

- 22 applied migration records through `0022` match repository SQL after
  comment/whitespace normalization. `0002` is intentionally staging-only.
  All 33 current private routine bodies match their latest repository definitions.
- All nine public business tables and `private.uc02_audit` have ENABLE/FORCE RLS.
  Anonymous grants expose only five public event columns under the visible-event
  policy, with no registration/attendee PII access or writes.
- `app_runtime`: LOGIN, no superuser/BYPASSRLS/CREATEROLE, no inherited role
  membership, no direct table privileges, and only intended routine EXECUTE.
  Ordinary browser roles cannot execute private mutations.
- `app_maintenance`: LOGIN, no elevated role flags, audited Technical recovery
  routine, read access to grants/audit, and the intentional DELETE grant on
  expired registration-attempt records. No direct event, registration, access,
  or audit mutation privileges. Neither application role can CREATE in `public`.
- SECURITY DEFINER ownership is `uc02_routine_owner`, with NOLOGIN and no
  BYPASSRLS. All fixed search paths are `public, pg_temp`; no dynamic SQL or
  email-address authorization literals occur in these routines.
- At the initial inspection, real production `request.jwt.claims` gave Technical
  and Board eight committees and each manager its one committee. The owner has
  since revoked the disposable Support grant; current reconciliation supersedes
  that earlier Support result. An unassigned identity sees zero. These read-only RLS probes do not substitute
  for the interactive account pilot.
- Data: five Auth identities, eight active committees, one isolated legacy
  committee, five archived M8 smoke events, four test-pattern registrations,
  and 46 application audit rows at inspection. No stale legacy grant,
  duplicate committee/assignment, orphan registration, invalid role scope,
  excess confirmed capacity, invalid supersession, stale approval, missing
  authenticated audit actor, or missing Auth audit target was found.
- The legacy archive remains a non-blocking cleanup candidate. Its records and
  audit history were preserved; no business data was deleted.

### Auth and Resend: configuration and delivery verified

- Supabase custom SMTP uses `smtp.resend.com:465`, sender
  `Engineering Society <no-reply@auth.essqu.com>`, a 60-second minimum interval,
  and 30 Auth emails/hour. It does not rely on the built-in mailer.
- Site URL is `https://engsoc-platform.vercel.app`; the allowlist contains only
  its `/auth/callback` and `/auth/reset` URLs. The working recovery template
  contains the token-hash callback and no localhost link. Invitation, confirmation
  and email-change templates retain `ConfirmationURL`; their completion has not
  been re-proven in this pass. The existing fragment relay remains in place.
- Resend dashboard confirms `auth.essqu.com`, DKIM, and SPF verified, with
  sending enabled. Public DNS agrees. Parent DMARC is `v=DMARC1; p=none;`;
  consider enforcement after reviewing legitimate sending sources. No DNS
  changes were made.
- Fresh recovery requested from `/admin/recovery` at approximately 05:36 UTC:
  received in the controlled Gmail inbox, and Resend reports **delivered**
  (message `01a114dc-ebcb-707b-aeaa-4e0cc2e1ef93`). The email link opened the
  production callback and then `/auth/reset` without a token in the visible URL.
  An older link was rejected with the expired-link message.
- **Owner-confirmed production recovery pilot: PASS.** This supersedes the earlier
  pending password-reset completion. No password was requested in chat or entered
  by the agent; the working recovery architecture is unchanged.
- One obsolete email link's hash fragments appeared during inbox DOM inspection
  despite URL redaction. That older link was verified expired; fresh-link
  handling now avoids emitting link contents or fragmented token text.
- Provider password minimum increased from 6 to **12**, matching the existing
  application rule. Existing identities were not reset by this setting change.
  Email confirmation is enabled, JWT lifetime is 3600 seconds, refresh-token
  reuse interval is 10 seconds, and session timebox/inactivity limits are unset.
- Leaked-password protection is **disabled and plan-gated**: enabling it through
  the supported API returned HTTP 402, requiring Pro or above. No subscription
  was changed. This is a documented non-blocking enhancement for this release;
  the setting has been checked, and the 12-character rule is enforced by Auth.

### Interactive production pilot

| Account                   | Evidence                                                                                                      | State                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Technical                 | Real sign-in, eight committees, access directory/details/history                                              | Verified; final lifecycle smoke pending                                     |
| Board                     | Owner-confirmed production pilot; global RLS and access-admin denial regressions                              | PASS                                                                        |
| Old Support test identity | Owner revoked access; retained Auth identity, revoked grant and four audit references independently inspected | No access; retain historical identity                                       |
| Real Support Manager      | Owner will supply the real email; no placeholder created                                                      | Assignment and interactive pilot pending                                    |
| Finance / Media           | One identity and one scope each, no elevated roles; live RLS checked                                          | Architecture verified; interactive acceptance optional when owners activate |

Last-Technical rejection, a second-Technical grant, and Board mutation denial
were executed against the freshly restored production archive and rolled back.
The live Technical owner was never revoked or replaced.

### Logs and recovery

- **Vercel access limitation understood:** the connector identity is not
  authorized for team scope `eng-crafters` (explicit 403). The CLI's separately
  authenticated identity successfully reads production request logs with the
  exact project/team IDs. A capped sample of 100 production request logs had no
  error-level or token-bearing records. No platform permissions were weakened.
- Supabase Management API reads Auth, Postgres, and pooler logs successfully.
  The Resend owner browser session provides delivery and domain evidence; the
  available local Resend API key is invalid and is unused by application Auth.
- Supabase backup API reports WAL archiving enabled, PITR **disabled**, and no
  listed physical backups or retention window. No paid recovery entitlement
  is inferred from WAL archiving alone.
- A fresh full logical database archive was created outside the repository at
  `%LOCALAPPDATA%/engsoc-platform/backups/readiness-2026-10-07.dump` (517,196
  bytes; SHA-256 `a86cb582083a0eeb1aeb7730010c0eff0df4b569db221936ae47852597087481`).
  It restored with `pg_restore --exit-on-error` into an isolated Supabase
  PostgreSQL 17.6 instance after creating missing role identities. Verified
  Auth identities, row counts, all table RLS flags, routine owners, and the
  ownership safeguards. This proves recovery of this database snapshot;
  hosted services, external secrets, Storage objects, future backups, and a
  timed production disaster-recovery objective are not covered.

### Required code repair: partial Auth administration outcomes

Auth creation/password/email actions now report when the external operation
succeeded but its audit write failed. They tell the operator not to repeat the
operation and to reconcile its history. Structured logs contain only actor and
target UUIDs, action, and fixed failure codes. Raw provider/SQL errors and
passwords are excluded. An uncertain access-grant response after account
creation is also translated into explicit reconciliation guidance.

Role grant/revoke/reassignment and their audit writes remain atomic PostgreSQL
operations. External Auth plus PostgreSQL remains non-atomic by design. Five
regression tests cover failed/throwing audit writes across four operation types
and an uncertain grant after account creation. No layout or styling changed.

The server-only Auth Admin module remains the sole service-role client. Its
callers are Technical server actions; the server page exposes only a configured
boolean. A scan of 57 built client files found no local private environment-value
matches. A future Supabase secret-key migration should validate Auth Admin API
compatibility in staging, rotate only the server credential, then revoke the
legacy key after deployment evidence; it is not required for this release.

## Non-blocking technical debt

- **Directory:** five managed production identities today; the Technical-only
  directory has no SQL pagination. It is not a current load bottleneck. Add
  server-side cursor pagination and bounded actor lookup before broad account
  growth; review at 200 identities. Do not claim an existing hard bound.
- **CSP:** current frame/base/object restrictions provide tested defense in
  depth but do not restrict scripts/styles. A full policy needs nonce/hydration
  and authenticated-flow testing; no guessed policy was deployed.
- **Auth/audit:** partial state is now visible and reconcilable. A concurrent
  Technical revocation can still overlap an external Auth request. Reconcile
  from Auth state/logs; do not add distributed transactions for this small workload.
- **DMARC, paid leaked-password protection, automated backup/PITR:** understood
  follow-ups. Manual snapshot recovery is proven; no automated recovery window
  is promised.

### Development dependency advisories

All following packages are development/CI tooling, absent from the production
request dependency audit (zero production advisories). They do not block release.
Npm's suggested major downgrades are not safe fixes. Patch candidates marked
below still need isolated compatibility verification; no force upgrade was run.

| Package                     | Severity | Runtime reachable | CI/dev only | Safe update established           | Disposition                      |
| --------------------------- | -------- | ----------------- | ----------- | --------------------------------- | -------------------------------- |
| `@esbuild-kit/core-utils`   | Moderate | No                | Yes         | No; Drizzle downgrade suggested   | Defer tooling update             |
| `@esbuild-kit/esm-loader`   | Moderate | No                | Yes         | No; Drizzle downgrade suggested   | Defer tooling update             |
| `@modelcontextprotocol/sdk` | High     | No                | Yes         | Patch candidate, unverified       | Defer; unused shadcn OAuth path  |
| `@next/eslint-plugin-next`  | High     | No                | Yes         | No; major downgrade suggested     | Defer glob-chain update          |
| `@ts-morph/common`          | High     | No                | Yes         | Patch candidate, unverified       | Defer tooling update             |
| `brace-expansion`           | High     | No                | Yes         | Patch candidate, unverified       | Defer; controlled build globs    |
| `braces`                    | High     | No                | Yes         | No; major downgrade suggested     | Defer glob-chain update          |
| `drizzle-kit`               | Moderate | No                | Yes         | No; major downgrade suggested     | Defer; no exposed dev server     |
| `esbuild`                   | Moderate | No                | Yes         | No; Drizzle chain requires review | Defer; no exposed dev server     |
| `eslint-config-next`        | High     | No                | Yes         | No; major downgrade suggested     | Defer with matching Next tooling |
| `fast-glob`                 | High     | No                | Yes         | No; major downgrade suggested     | Defer glob-chain update          |
| `fast-uri`                  | Moderate | No                | Yes         | Patch candidate, unverified       | Defer tooling update             |
| `micromatch`                | High     | No                | Yes         | No; major downgrade suggested     | Defer glob-chain update          |
| `shadcn`                    | High     | No                | Yes         | No; major downgrade suggested     | Defer tooling update             |
| `ts-morph`                  | High     | No                | Yes         | Patch candidate, unverified       | Defer tooling update             |

## Focused access-lifecycle extension (ADR 0014)

Migration 0023 introduces a Technical-only fixed manager-replacement routine and
serializes ordinary access changes with the existing Technical-ownership lock.
The selected old grant is revoked, the new one assigned, and both histories are
written atomically with a shared replacement ID. Events and earlier audit actors
are never reassigned. The existing many-managers-per-committee policy remains;
each person still has exactly one committee. Stale revocation scope and a second
manager scope return explicit domain errors.

Auth-only onboarding, effective None role/scope after revoke, details showing Auth
existence separately from admin access, and previous/resulting audit states use
the existing components. No session invalidation is claimed: the supported Admin
sign-out API requires a target session JWT, not a user ID. Current database grants
deny revoked identities independently of Auth session lifetime. Exceptional Auth
deletion remains reviewed infrastructure maintenance; retained grants or history
make the old Support test identity ineligible. No deletion button was added.

Targeted tests cover replacement and concurrent competing replacements, competing
scope/elevated assignments, an already-scoped replacement, audit-failure rollback,
revocation concurrent with a privileged write, last-Technical protection, current
RLS/routine denial, direct DML denial, and retained attribution. Protected-layout
and direct Technical-page tests are component boundary tests, not a claim that a
real revoked account completed browser sign-in. Server-action denial is separately
tested. No active browser session for the old Support identity was available.

Staging migration 0023 (version 20261007090000) passed. Its actual restricted
runtime connection rejects an unassigned actor and direct table reads. A fresh
production archive was restored into isolated Supabase PostgreSQL 17.6, migration
0023 applied, and a replacement executed successfully then rolled back. The
private archive is at %LOCALAPPDATA%/engsoc-platform/backups/lifecycle-2026-10-07.dump
(517,028 bytes; SHA-256
194a965905eade5aa034845b209050de42ba95a1f0dfaad376aed27b41dbd32f).
No live production assignment was changed in that rehearsal.

### Lifecycle production reconciliation

Production migration 0023 is applied as version 20261007090000; all 23 expected
records are present (0002 remains staging-only). Its stored SQL matches the
repository. Both changed/new routines use the NOLOGIN routine owner and fixed
search_path; only app_runtime has the application EXECUTE grant. Browser roles
and app_maintenance cannot execute replacement. app_runtime retains no direct
table privileges. All nine public tables and private audit retain FORCE RLS.

Read-only reconciliation found five unique Auth users, eight catalog committees,
one legacy committee, five preserved events, four registrations and 47 audit
rows. No duplicate identities, invalid active scope or active legacy grants.
Technical and Board each see eight committees under real production claims;
Finance sees only finance, Media only media. The revoked Support identity sees
zero committees, active grants, events or registrations. A controlled mutation
denial probe returned NOT_FOUND, left event/audit counts unchanged, and was
rolled back. Its four historical audit references remain. A strict read-only
transaction cannot invoke routines using row locks; that first probe correctly
returned PostgreSQL 25006, not an authorization result.

Local final gates: format, lint, typecheck, 232 tests in 35 files, db:check,
production build, 37 Playwright passes / one intentional skip, and diff checks.
The tests replay migrations from zero. The earlier 235 test total included three
identical layout assertions, consolidated before release. Secret-value scans of
27 staged files and 41 built client chunks found no matches; public site origin
and already-documented account email matches are not secrets.

## Release gate and deployment evidence

The previous hardening release is deployed at commit
9f56ee4c3006d534ba5b376872bcee252564d342; GitHub CI 37579275465 passed and
Vercel dpl_2Jqz55YNFRpTkYCiazvmnf8NjwrE was READY. Those results do not yet prove
the lifecycle deployment. Local gates and the production migration are complete;
exact lifecycle commit/deployment evidence will be recorded after the push.

Owner-confirmed Recovery and Board pilots are PASS and need no repeat. The real
Support manager's email is still required for assignment and the requested pilot;
the old disposable account must not be reactivated as a substitute. Finance/Media
interactive acceptance is optional once architectural integrity is verified.

**NOT READY FOR LANDING PAGE MIGRATION** while the focused release is unfinished
and the required real Support manager pilot remains pending. Exact next actions:
finish the coherent lifecycle validation/deployment and production reconciliation;
then the owner provides the real Support email and completes private sign-in for
its scope/denial pilot. No passwords or recovery links should be shared.

Paid leaked-password protection, automated backup/PITR, stronger DMARC/CSP,
development advisories, future directory pagination and the documented external
Auth/audit reconciliation boundary remain non-blocking technical debt.
