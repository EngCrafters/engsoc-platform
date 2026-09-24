# Current work — handoff state

See `docs/UC-02_Acceptance_and_Delivery.md` for evidence and
`docs/UC-02_Deep_Dive.md` for the frozen behavior contract.

**CURRENT MILESTONE:** UC-02 M8 release and closure. M7 was delivered on
September 23, 2026. Do not start another milestone.

**M8 SOURCE:** The manager overview now uses a scoped database count routine
across all event pages and lifecycle states. The registration export rejects
invalid status, oversize or inconsistent output instead of returning a false
success. The event editor locks archived/past controls, warns before approval
invalidation, and rejects duplicate or malformed form input server-side.
Recovery-link failures have explicit safe guidance. Cross-surface and
revocation tests cover list/detail/public/export parity. Commit `2fdc72f`
was pushed to `main` on September 24. Full local gates passed: format, lint,
typecheck, 120 tests, DB check, build, 20 Playwright tests and diff check.
GitHub CI run `36026002317` succeeded. Vercel production deployment
`dpl_GsmSjpL8MLmpGvcJvwNR5HJEKwYE` is Ready and serves the public alias.

**STAGING:** `wnrdgnmmcdedmilnzzsl` is active. Migration 0015 was applied on
September 24. All ten inspected UC-02 tables have ENABLE/FORCE RLS. The new
routine has the expected owner, fixed search path, and app-runtime-only
execution. A live `app_runtime` connection confirmed unknown-actor count zero
and denied direct event-table reads.

**PRODUCTION SECURITY:** The owner selected original main
`rbeyqrfypowyocmnmvwu` for the eventual M8 release. It was resumed and is
`ACTIVE_HEALTHY`. Live read-only inspection corrected the stale preflight:
all ten UC-02 tables already had ENABLE and FORCE RLS. The schema and data
were dumped before change. Missing additive migrations 0007–0015 were then
applied on September 24. Catalog verification confirms expected routine
ownership, fixed search paths, execution grants, and no direct runtime or
maintenance table grants. Real production `app_runtime` login behavior remains
unverified because its existing password is unavailable in this workspace.

**DEPLOYMENT ACCESS:** Vercel CLI under `eng-crafters` can inspect production
deployments and the public alias returns HTTP 200. The Vercel MCP connection
still receives team-scope 403, but CLI inspection works. Vercel Production
currently uses staging; it has not been changed to main. The ignored
`.env.local` lacks the named staging manager email/password required by the
deployed browser smoke script. Main has no auth users, committees, grants, or
events, so production manager smoke and initial provisioning need an owner
identity and credentials. The September 23 authenticated M7 smoke passed.

**NEXT EXACT TASK:** Obtain the authorized first-manager identity and
committee, provision main through the maintenance path, establish a known
main `app_runtime` secret, configure production Vercel variables for main,
and complete real-role and deployed manager smoke. The required named staging
smoke credentials are also absent from `.env.local`. Keep M8 open until the
serving Vercel environment can safely switch to main and all evidence passes.
