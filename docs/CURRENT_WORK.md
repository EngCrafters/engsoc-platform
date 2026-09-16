# Current work — handoff state

Keep this short. See `docs/UC-02_Acceptance_and_Delivery.md` for full evidence
and `docs/UC-02_Deep_Dive.md` for behavior specification.

**CURRENT MILESTONE:** UC-02 M5 (Admin identity and scope) — external
verification pending.

**CURRENT STATUS:** M1–M4 are delivered. M5’s local implementation adds
request-scoped Supabase SSR clients and session refresh, provisioned-user
login/logout/recovery/reset, a protected admin shell, database-backed active
committee-manager grants, safe internal redirects, and no-signup browser
coverage. It does not add a Member model or event-management UI.

**LAST DELIVERED COMMIT:** `aa998ae feat(uc-02): close M4 with deterministic
E2E and three latent bug fixes`.

**KNOWN BLOCKERS:** Before M5 can close, configure `AUTH_REDIRECT_ORIGIN` in
the deployed environment and allowlist its `/auth/callback` URL in Supabase
Auth. Supply the existing staging manager password only as a local/CI secret
to run the real authenticated JWT/login, committee-scope and revocation test.

**NEXT EXACT TASK:** Verify those two external Auth inputs, run the staging
manager test, close M5, then start M6.
