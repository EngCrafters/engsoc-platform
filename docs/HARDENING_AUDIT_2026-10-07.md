# Pre-expansion hardening audit — October 7, 2026

Status: **BLOCKED on owner recovery completion and Board/Support interactive sign-in**.
The broad repository audit is complete. The production evidence below supersedes
the earlier unavailable-access findings. No UI appearance or business data was changed.

## Boundary and evidence

- Current access authority is ADR 0012, `ACCESS_CONTROL.md`, and the live
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
- All 10 public business tables and `private.uc02_audit` have ENABLE/FORCE RLS.
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
- Under real production `request.jwt.claims`, Technical and Board see eight
  committees, Support/Finance/Media each see exactly their committee, and an
  unassigned identity sees zero. These read-only RLS probes do not substitute
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
- The owner must finish password mismatch, update, session-end, and new-password
  sign-in checks. No password was requested in chat or entered by the agent.
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

| Account         | Evidence                                                                                                                                                | State                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Technical       | Real sign-in; `/admin`, all eight committees, `/admin/access`, five-user directory, Board/Support/Finance/Media assignments, details, and audit history | Verified                                      |
| Board           | Live production RLS: eight committees; no interactive sign-in in this closure pass yet                                                                  | Owner sign-in pending                         |
| Support Manager | Live production RLS: Support only; identity still invited/unconfirmed                                                                                   | Owner invitation/recovery and sign-in pending |
| Finance / Media | Live production RLS: exactly one assigned committee each; neither had signed in at inspection                                                           | Optional lighter sign-in checks pending       |

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

## Release gate

Complete the owner password-reset and Board/Support interactive checks before
issuing GO. Finance/Media lighter checks may follow when those owners are
available. The closure changes passed format, lint, typecheck, all 214 tests, db:check,
production build, 37 Playwright tests (one intentional skip), production dependency
audit (zero advisories), and diff hygiene. The database suite replays migrations
from scratch; no new migration was needed. Commit/push, exact-commit GitHub CI
and Vercel evidence are recorded as deployment completes. Landing-page migration
has not started.

### Deployment evidence and exact remaining actions

- Application/documentation commit `f3742552c14c7312f00a721252b16ddb64fbdbaa`
  is pushed to `main`. [GitHub CI run 37578700777](https://github.com/EngCrafters/engsoc-platform/actions/runs/37578700777)
  completed successfully, including database and browser checks.
- Vercel production deployment `dpl_GB1TEMC6rfVcqLkeh6DrKJxyC12N` is READY
  on that exact SHA and assigned `engsoc-platform.vercel.app`. Post-deployment
  public/login/recovery/reset responses and unauthenticated access redirect
  passed, with security headers present.
- The restore container and temporary credential-access helper were removed.
  The sensitive logical archive was deliberately retained outside the repository.
  Existing user-managed untracked files were not staged, modified or removed.

**NOT READY FOR LANDING PAGE MIGRATION** until these owner steps have evidence:

1. Finish the open recovery form: mismatched confirmation rejected, matching
   new password accepted, recovery session ended, and new-password login succeeds.
   Then verify the consumed link is rejected. Do not share the password or link.
2. Sign in as `engineeringsociety.squ@gmail.com`; verify global committees and
   operational counts, allowed event/registration paths, and denial of
   `/admin/access` and Technical controls.
3. Accept the existing Support invitation if necessary and sign in as
   `unknown11110000@gmail.com`; verify Support-only events/counts/registration
   operations, no committee switcher, and denial of foreign scope and
   `/admin/access`. Finance/Media lighter checks can follow when available.

No other remaining item is classified as a release blocker. Paid leaked-password
protection, automated backup/PITR, stronger DMARC/CSP, development advisories and
future directory pagination are explicitly documented follow-ups. Final owner
sign-in evidence must be recorded before changing the decision to READY.
