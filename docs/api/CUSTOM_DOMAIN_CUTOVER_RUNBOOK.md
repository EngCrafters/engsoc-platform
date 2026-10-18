# ESSQU custom-domain cutover checklist

Status: **pre-domain preparation, October 18, 2026**. No custom domain or DNS
change has been made. This document records gates for a later cutover, not
authorization to execute them now. Preserve the existing Core service and Auth
configuration until each prerequisite is verified.

## Current deployment map

| Component | Current evidence                                                                                                                                                            | Planned hostname                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Core      | `EngCrafters/engsoc-platform`, baseline `15875f4`, `https://engsoc-platform.vercel.app`                                                                                     | `api.essqu.com`, `admin.essqu.com` |
| Landing   | Private `EngCrafters/essqu-web`, preserved source `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0`; Git-connected Vercel project `essqu-web` (`prj_yXxcM8AlVAuARpepUJMUAo4N20AL`) | `essqu.com`, `www.essqu.com`       |

GitHub identifies `EngCrafters` as a User namespace, not an Organization.
Landing deployment readiness and its cross-project staging smoke are pending.
Project creation and a Git connection alone do not prove a working deployment.

## Pre-domain gates

- [x] Separate Landing repository and Vercel project created; original source preserved.
- [x] Migration 0024 applied to staging `wnrdgnmmcdedmilnzzsl` through MCP.
- [x] Staging catalog invariants verified: forced RLS, owner SELECT policy,
      runtime-only routine execution, no runtime table grants, five registrations retained.
- [ ] Staging API client provisioned privately and installed server-side on Landing.
- [ ] Staging Core and Landing deployments verified at their actual URLs.
- [ ] Live restricted-runtime HTTP verification and cross-project browser registration
      pass, including confirmed, explicit waitlist, duplicate and capacity-race outcomes.
- [ ] Final local gates, GitHub CI and Vercel deployment evidence recorded for both repositories.
- [x] Owner accepted backup risk only for unchanged additive 0024 after live staging/concurrency passes; no backup is claimed.
- [ ] Live staging/concurrency gate and exact-file preflight for the waiver completed.
- [ ] Production migration 0024 applied explicitly and catalog invariants rechecked.
- [ ] Production `events:read` client installed only in Landing's server environment.

Production currently lacks 0024, retains seven registrations, has forced RLS on
all ten application tables, zero `app_runtime` table grants and NOBYPASSRLS.
The Free organization returned no listed backup or PITR point in authenticated
inspection (`backups: null`, `physical_backup_data: {}`, `pitr_enabled: false`,
`walg_enabled: true`). The owner waived managed-backup readiness only for exact
unchanged migration 0024, conditional on successful live staging and concurrency
checks. This is a recorded risk acceptance, not evidence of recovery readiness.
Keep production 0024 pending until those checks pass; the waiver covers no other
DDL or existing-row DML. Do not take a local dump/export of PII, upgrade the
subscription, or change domains/Auth under this waiver. The owner confirmed
retaining Landing under the `EngCrafters` User namespace.

## Future domain and Auth sequence

1. Record the current Vercel aliases, origins, Auth callback allow-list and
   enforcement settings privately so configuration can be restored.
2. Add `api.essqu.com` to Core, apply exactly the DNS records Vercel supplies,
   wait for valid TLS, and verify no-key 401 and scoped-key 200 event reads.
3. Add `admin.essqu.com` to the same Core project and verify valid TLS.
4. Add `https://admin.essqu.com/auth/callback` to Supabase's allow-list while
   retaining the existing callback. Set `APP_ORIGIN` and
   `AUTH_REDIRECT_ORIGIN` to `https://admin.essqu.com` together and deploy.
5. Verify sign-in, sign-out, emailed recovery, reset, signed-out protected-route
   redirects and rejected foreign `next` values before retiring the old origin.
6. Configure Landing's server-only production Core base URL and read key, then
   attach `essqu.com` and redirect `www.essqu.com` to the apex; verify DNS and TLS.
7. Verify exact-origin registration CORS, public event list/detail, safe error
   handling, no credential in browser assets, and no database credential in Landing.
   Use staging for attendee-writing scenarios; do not manufacture production registrations.
8. Only after hostnames and Auth are verified, enable Core host enforcement and
   deploy. Check API-host `/admin/login` and `/auth/*` return 404, admin-host
   `/v1/events` returns 404, and intended API/admin routes remain available.
9. Observe both deployments and retain the previous callback/rollback settings
   until normal operation is established.

## Rollback and evidence

Keep Core's working Vercel alias available during preparation. If verification
fails, restore the previous host-enforcement/origin settings and deployment,
retain the working callback URL, and revert only the DNS/domain changes made in
the failed cutover. Preserve database records and additive schema; do not drop
the API registry as an automatic rollback.

Record commit SHA, CI run, Vercel deployment ID and actual URL, migration version,
restore readiness, checks performed and unresolved holds in
[CURRENT_WORK.md](../CURRENT_WORK.md). Never record raw tokens, passwords,
connection strings or attendee details. The
[production runbook](PRODUCTION_CUTOVER_RUNBOOK.md) contains migration and client
operations; the [Landing handoff](LANDING_HANDOFF_V1.md) is the consumer contract.
