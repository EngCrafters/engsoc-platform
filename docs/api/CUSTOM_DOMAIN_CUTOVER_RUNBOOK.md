# ESSQU custom-domain cutover checklist

Status: **pre-domain preparation, October 19, 2026 (Dubai)**. No custom domain or DNS
change has been made. This document records gates for a later cutover, not
authorization to execute them now. Preserve the existing Core service and Auth
configuration until each prerequisite is verified.

## Current deployment map

| Component | Current evidence                                                                                                                                                            | Planned hostname                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Core      | `EngCrafters/engsoc-platform`, baseline `15875f4`, `https://engsoc-platform.vercel.app`                                                                                     | `api.essqu.com`, `admin.essqu.com` |
| Landing   | Private `EngCrafters/essqu-web`, preserved source `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0`; Git-connected Vercel project `essqu-web` (`prj_yXxcM8AlVAuARpepUJMUAo4N20AL`) | `essqu.com`, `www.essqu.com`       |

GitHub identifies `EngCrafters` as a User namespace, not an Organization.
Landing cross-project staging verification passed, including a real credential-free
confirmed registration. Production API reads passed; Landing is Ready at `https://essqu-web.vercel.app`.
Final actual-secret browser verification passed for English/Arabic on desktop/mobile.

## Pre-domain gates

- [x] Separate Landing repository and Vercel project created; original source preserved.
- [x] Migration 0024 applied to staging `wnrdgnmmcdedmilnzzsl` through MCP.
- [x] Staging catalog invariants verified: forced RLS, owner SELECT policy,
      runtime-only routine execution, no runtime table grants, five registrations retained.
- [x] Staging API client provisioned privately and installed server-side on Landing.
- [x] Staging Core and Landing deployments verified at their actual URLs.
- [x] Live restricted-runtime HTTP verification and cross-project browser registration
      pass, including confirmed, explicit waitlist, duplicate and capacity-race outcomes.
- [x] Final local gates, GitHub CI and Vercel deployment evidence recorded for both repositories.
- [x] Owner accepted backup risk only for unchanged additive 0024 after live staging/concurrency passes; no backup is claimed.
- [x] Live staging/concurrency gate and exact-file preflight for the waiver completed.
- [x] Production migration 0024 applied explicitly and catalog invariants rechecked.
- [x] Production `events:read` client installed only in Landing's server environment.

Production has 0024 version `20261018200028`, retains seven registrations with an
unchanged fingerprint, and has forced RLS on eleven tables (ten prior plus registry),
zero direct/effective `app_runtime` table privileges and NOBYPASSRLS.
The Free organization returned no listed backup or PITR point in authenticated
inspection (`backups: null`, `physical_backup_data: {}`, `pitr_enabled: false`,
`walg_enabled: true`). The owner waived managed-backup readiness only for exact
unchanged migration 0024, conditional on successful live staging and concurrency
checks. This is a recorded risk acceptance, not evidence of recovery readiness.
Those checks passed before the exact 0024 application in an explicit transaction;
the waiver covers no other DDL or existing-row DML. Do not take a local dump/export of PII, upgrade the
subscription, or change domains/Auth under this waiver. The owner confirmed
retaining Landing under the `EngCrafters` User namespace.

Pre-domain functional verification is complete. Existing fresh real-credential Auth
pilot flows, the leaked-password protection warning and development-only advisory
follow-ups remain deferred; none is represented as completed by browser boundary checks.

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
6. Switch both Landing URL variables together to the custom API:
   `CORE_API_BASE_URL=https://api.essqu.com/v1` for server reads and
   `NEXT_PUBLIC_CORE_API_BASE_URL=https://api.essqu.com/v1` for browser registration.
   Keep the read key server-only. Deploy, attach `essqu.com`, redirect
   `www.essqu.com` to the apex, and verify DNS/TLS.
7. Verify exact-origin registration CORS, public event list/detail, safe error
   handling, no credential in browser assets, and no database credential in Landing.
   Use staging for attendee-writing scenarios; do not manufacture production registrations.
8. Only after hostnames and Auth are verified, enable Core host enforcement and
   deploy. Check API-host `/admin/login` and `/auth/*` return 404, admin-host
   `/v1/events` returns 404, and intended API/admin routes remain available.
9. Observe both deployments and retain the previous callback/rollback settings
   until normal operation is established. Then remove temporary production origin
   `https://essqu-web.vercel.app` from Core's exact-origin CORS allowlist. Retain
   intended custom origins and separately configured staging origins. Redeploy
   Core; verify custom-origin CORS works and the retired origin receives no
   allow-origin header before retiring old aliases.

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
