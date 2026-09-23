# Current work — handoff state

Keep this short. See `docs/UC-02_Acceptance_and_Delivery.md` for full evidence
and `docs/UC-02_Deep_Dive.md` for behavior specification.

**CURRENT MILESTONE:** UC-02 M8 (release and closure) — M7 is delivered in source, CI, staging, and Vercel on September 23, 2026. M8 release verification is now active.

**SOURCE / CI:** Origin `main` contains `72ee5f0` (fixed create/edit routines)
and `aeeed87` (M6 admin UI, migrations 0009–0011, account/security, maintenance
model, tests). GitHub Actions run `35840419684` for `aeeed87` passed. The final
local worktree passed format, lint, typecheck, 102/102 Vitest tests, db:check,
build, 20/20 Playwright tests, and diff whitespace check.

**STAGING:** Migrations 0008–0011 are recorded as Supabase versions
`20260923010000`–`20260923010300` on staging. Routine ownership, execute
grants, and direct-DML restrictions were verified. Live `app_runtime`,
`app_maintenance`, cross-committee, and authenticated-RLS smoke transactions
passed and rolled back; fixture counts were unchanged. Browser checks against
a local production build connected to staging passed named-manager password
login, event list/detail, create form, safe missing/malformed IDs,
account/scope display, session persistence, logout, and generic recovery
feedback. No password, token, or recovery link is in the repository.

M7 migrations 0012â€“0014 are recorded as `20260923010400`, `20260923010500`,
and `20260923010600`. The registration list/count/export routines are scoped to
the manager's event committee; staging runtime smoke returned the authorized
registration and zero rows for a foreign actor. Export auditing and FIFO
promotion use fixed routines; attendance editing, cancellation, and search
remain out of scope.

**VERCEL:** Production environment configuration was corrected on September
23, 2026. `NEXT_PUBLIC_SUPABASE_URL`, the matching anon key, and
`APP_RUNTIME_DATABASE_URL` now target the staging Supabase project that owns
the named staging manager. A fresh production deployment is Ready at
`https://engsoc-platform-farzeduek-eng-crafters.vercel.app` and is aliased to
`https://engsoc-platform.vercel.app`. The prior failure was a backend-project
mismatch, not an event-list or authorization defect.

**M7 AUTHENTICATED BROWSER SMOKE:** The Ready Vercel deployment passed the named-manager desktop and 390px mobile smoke on September 23, 2026. Login and session establishment, registration tabs/counts, cursor pagination, formula-safe CSV export, FIFO promotion, malformed cursor handling, foreign-committee denial, and absence of maintenance controls all passed. Temporary fixtures were removed after the run.

**NEXT EXACT TASK:** Complete the frozen M8 UC-02 release/closure evidence: role and end-to-end matrix, serving-database/RLS verification through the authorized procedure, isolated backup/restore evidence, deployment/runtime checks, and documentation reconciliation. Do not begin product features outside the release scope.

**M8 BLOCKER:** The serving main Supabase project remains the documented
release blocker because RLS is disabled on its business tables. Applying the
tested RLS/grants requires the authorized production database procedure; this
cycle made no production SQL changes.
