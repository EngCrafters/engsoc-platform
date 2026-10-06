# Pre-expansion hardening audit — October 7, 2026

Status: **follow-up required before landing-page migration**. This is the
repository audit record; production checks and outstanding operator actions
must be read alongside `CURRENT_WORK.md`. No UI appearance or business data was
changed.

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
  public/unauthenticated boundaries. Production role sign-in and live database
  drift were not freshly proven by this audit.

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

## Remaining findings and operator actions

1. **High — rotate the staging migration database credential.** During this
   audit a PowerShell URI parse error emitted the staging `DATABASE_URL` value
   into a tool result. It was not committed or repeated here. Rotate that
   credential in Supabase, update the private local/CI secret stores that use
   it, and inspect staging database login activity. Do not put its value in an
   issue, chat, commit or audit note.
2. **Production database state unverified.** Local database URLs identify the
   staging project. No production SQL credential or Supabase management
   connection was available to this audit. A production maintainer must read
   grants, RLS, migration journal, row counts, orphan/impossible states, access
   assignments and the isolated legacy `Events` records without writing data.
   Preserve the legacy archive and its audit history until provenance and a
   fresh backup are verified.
3. **Production Auth email state unverified.** The owner reports Resend works,
   and Vercel has the required variable names. Verify Supabase custom SMTP,
   sender/domain SPF and DKIM, DMARC, template URLs, rate limits, Resend logs
   and delivery to a controlled real inbox. Reuse/expiry must be verified
   without recording links. The app's `RESEND_API_KEY` is currently unused.
4. **Leaked-password protection and backup entitlement unknown.** Inspect
   Supabase Auth password settings and enable leaked-password rejection if the
   project plan supports it; otherwise record the plan decision. Confirm
   current backup/PITR status and rehearse a fresh isolated restore before
   destructive work. The October 4 logical archive is historical evidence.
5. **Auth Admin API reconciliation.** A Technical grant is checked before each
   server action, but a concurrent revocation and external Auth API call cannot
   be atomic with PostgreSQL. Reconcile a failed audit log with live Auth state.
   Consider a dedicated serialized workflow if user administration volume or
   threat level grows.
6. **Moderate-scale directory growth.** The Technical directory returns all
   Auth identities, and each history view reads the directory again to resolve
   actor emails. Add cursor pagination and a bounded actor lookup before
   thousands of identities. Event and registration lists already paginate;
   registration CSV is bounded.
7. **Development dependency advisories.** The remaining npm advisories are in
   tooling such as shadcn, Drizzle Kit, ESLint and their transitives. They are
   absent from `npm audit --omit=dev` and not reachable through deployed
   requests. Update them in isolated changes with regression checks.
8. **Authenticated production UI pilot incomplete.** Public and signed-out
   routes can be smoked without credentials. Re-run the Technical/Board/Manager
   sign-in matrix and protected mobile screens with named real accounts; do
   not infer this from hidden controls or the database test fixtures.

## Operations

Use `Platform_Maintenance_Runbook.md` for failure logs and isolated recovery.
Before the landing-page migration, close the production evidence and credential
rotation items above. The legacy `Events` row remains a cleanup candidate, not
an authorized deletion. No production business data was deleted in this pass.
