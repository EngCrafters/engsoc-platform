# Current work — handoff state

Keep this short. See `docs/UC-02_Acceptance_and_Delivery.md` for full evidence
and `docs/UC-02_Deep_Dive.md` for behavior specification.

**CURRENT MILESTONE:** UC-02 M6 (Event management and approval) — ready to
begin after M5 delivery verification.

**CURRENT STATUS:** M1–M5 are delivered in source and staging. M5 adds
request-scoped Supabase SSR clients and session refresh, provisioned-user
login/logout/recovery/reset, a protected admin shell, database-backed active
committee-manager grants, safe internal redirects, and no-signup browser
coverage. It does not add a Member model or event-management UI.

**LAST DELIVERED COMMIT:** `2d5c08f docs(uc-02): close M5 auth evidence`.

**VERIFIED M5 EVIDENCE:** The named staging-only manager has exactly one active
Events committee grant; its real password login/JWT-scoped RLS query passed on
September 17, 2026. Staging Auth accepted a password-recovery request using
the configured fixed callback origin. Credentials remain local-only. GitHub CI
for `1fed3e4` and `2d5c08f` is green. Vercel project access is currently 403, so deployment
status/configuration remains independently unverified.

**NEXT EXACT TASK:** Read M6's authoritative scope and implement its first
dependency-ordered vertical slice. Do not add Member features or registration
operations/UI before their owning milestones.
