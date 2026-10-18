# ESSQU Core — production cutover runbook

Status (October 18, 2026): **production cutover is held**. Core continues serving
at `https://engsoc-platform.vercel.app`; custom domains, DNS, Auth origins and
host enforcement remain unchanged. The current pre-domain work has not yet been
committed or deployed. The checklist below describes future operations; it is
not evidence that an operation has run.

Staging `wnrdgnmmcdedmilnzzsl` has migration 0024 applied through Supabase MCP.
Forced RLS, the routine-owner SELECT policy, restricted execution and zero
runtime table grants passed; five existing registrations were retained.
Production `rbeyqrfypowyocmnmvwu` lacks 0024 and retains seven registrations.
All ten application tables have forced RLS and runtime table grants remain zero.
Staging client/deployment/live verification is pending. See the
[custom-domain runbook](CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md) for the release gates.

Ordering follows the program's release order and is not negotiable: Core
compatible first, landing switches last.

| #   | Gate                    | State                      |
| --- | ----------------------- | -------------------------- |
| A   | Production DB migration | **not applied**            |
| B   | Production API client   | **not created**            |
| C   | DNS / domain cutover    | **not started**            |
| D   | Auth redirect cutover   | **not started**            |
| E   | Managed recovery path   | **not verified; blocks A** |

---

## A. Production database migration

**File:** `db/migrations/0024_api_clients.sql` (journal tag `0024_api_clients`)

**What it does:** one private table (`private.api_clients`), one routine
(`private.verify_api_client`), one SELECT policy for the routine owner, and one
`GRANT EXECUTE` to `app_runtime`. No existing table, policy, grant or routine
is touched. No row anywhere is modified.

**Rehearsal evidence** (replayed `0000`–`0023`, then applied only `0024`,
exactly as production will):

`@
head before upgrade 0023_access_lifecycle
registrations 1 -> 1
public tables 9 -> 9
RLS enabled + forced 9/9 public, and private.api_clients
app_runtime table privs 0
anon / authenticated cannot execute verify_api_client
app_runtime can execute it
direct table read denied 42501
register_for_event SUCCESS after the upgrade

valid client 1 row
correct staging env 1 row
wrong hash / unknown prefix / inactive / revoked / expired / wrong env 0 rows each
valid active client without the required scope 1 row, has_scope = false
`@

`db:check` is green. The migration is **transactional and self-verifying**: its
final `DO` block raises and rolls everything back if `app_runtime` ends up with
any table privilege, if it cannot execute the routine, or if `PUBLIC` can.

**The bug the rehearsal caught, and why it matters here:** `FORCE ROW LEVEL
SECURITY` applies to the table _owner_, so with no policy the
`SECURITY DEFINER` routine was default-denied and returned zero rows for a
valid client — the auth path was silently inert. Fixed with a SELECT-only policy
for `uc02_routine_owner`. Do not "tidy" that policy away.

**What is needed to apply it:** first verify the managed recovery gate in section
E, then use the privileged Supabase MCP `apply_migration` route against the
explicit production ref. MCP successfully applied the same migration to staging;
the production hold is recovery readiness, not lack of a DDL tool. Production
DDL remains unperformed.

**Do not use `npx supabase db push`.** Production's history is
timestamp-versioned while this repository's files are `NNNN_`-named, so a push
has no defined scope. Use the explicit single migration and verify its scope.

**Verify afterwards, read-only:**

`@sql
select version from supabase_migrations.schema_migrations order by version desc limit 1;
select relrowsecurity, relforcerowsecurity from pg_class where oid = 'private.api_clients'::regclass;
select count(*) from information_schema.role_table_grants
 where grantee = 'app_runtime' and table_schema in ('public','private');   -- must be 0
select has_function_privilege('anon','private.verify_api_client(text,text,text,text)','EXECUTE');  -- false
`@

**Behaviour after applying, before any key exists:** `GET /v1/events` with a
bogus token flips from **503** to **401**. That is the signal the registry is
live.

Both event-read endpoints return **401** (`unauthorized`) for missing, malformed,
unknown, wrong-hash, inactive, revoked, expired or wrong-environment credentials.
A valid active credential without `events:read` returns **403** (`forbidden`);
the registry returns its client row with `has_scope = false` so authentication
and scope denial remain distinct. A registry failure returns **503**.

**Rollback:** Prefer disabling consumers and reverting application configuration
while preserving the additive registry and audit history. Dropping the function
and table is a separate destructive operation requiring a verified absence of
clients/dependencies and explicit authorization; do not treat it as a routine
recovery command after client provisioning.

---

## B. Production API client

**This is a security-authority action.** No production key has been generated.

- Client name: `ESSQU Landing Production`
- Scope: `events:read`
- Environment: `production`

**Token format:** `essq_live_<prefix>_<secret>` where `<secret>` is 32+ base64url
characters of 256-bit entropy. Only the prefix and `sha256(full token)` are
stored; the raw token is shown **once**.

**Creating it** — as a privileged operator, not as `app_runtime`:

`@sql
insert into private.api_clients (name, key_prefix, key_hash, environment, scopes, active)
values ('ESSQU Landing Production', '<prefix>', '<sha256 of the full token>', 'production', '{events:read}', true);
`@

Generate the token and hash locally, e.g. `openssl rand -base64 48`, and compute
the hash with `printf '%s' "$TOKEN" | sha256sum`. **Never** paste the raw token
into Git, a PR, a ticket, a log, or chat.

**Installing it:** Landing Vercel project → Settings → Environment Variables →
Production → `CORE_EVENTS_API_KEY` (secret). Also set
`CORE_API_BASE_URL=https://api.essqu.com/v1`. The key is **server-only**: never
`NEXT_PUBLIC_*`.

**Rotation without downtime:** create a second client with the same scope →
install on Landing and deploy → verify traffic → revoke the old one. Both are
valid in between, so no synchronised cutover is needed.

**Emergency revocation:** `update private.api_clients set active = false,
revoked_at = now() where key_prefix = '<prefix>';` — reads fail closed
immediately; no deploy required.

**Listing without secrets:** `select id, name, key_prefix, environment, scopes,
active, created_at, expires_at, revoked_at from private.api_clients;` — the hash
is never selected.

---

## C. DNS / domain cutover

| Hostname          | Vercel project                    | Purpose                     |
| ----------------- | --------------------------------- | --------------------------- |
| `essqu.com`       | **Landing** (separate repository) | public site                 |
| `www.essqu.com`   | Landing                           | 308 redirect to `essqu.com` |
| `api.essqu.com`   | **Core** (this repository)        | `/v1` only                  |
| `admin.essqu.com` | **Core** (this repository)        | admin + Auth only           |

Both Core hostnames attach to the **same** Core Vercel project.

**Records:** add each hostname in the relevant Vercel project → Domains, and
create the A/AAAA or CNAME records Vercel displays. SSL is issued automatically
once DNS resolves; wait for the certificate to show as valid before switching
traffic.

**Order:** attach `api.essqu.com` and verify it _before_ `admin.essqu.com`, and
leave `essqu.com` last — the landing site is the only one with public traffic.

**Only after all four are attached and serving**, set
`CORE_API_HOST_ENFORCEMENT=true` on the Core production environment and
redeploy. Then verify:

`@
api.essqu.com/v1/events            -> 401 (no credential)
api.essqu.com/admin/login          -> 404
admin.essqu.com/admin/login        -> 200
admin.essqu.com/v1/events          -> 404
`@

Enforcement is deliberately **off** until this point: switching it on before the
hostnames exist would take the working deployment down.

**Rollback:** delete the custom domains; the deployment remains reachable at
`engsoc-platform.vercel.app`. Forget `CORE_API_HOST_ENFORCEMENT` to return to
dormant. Revert DNS records at the registrar.

---

## D. Auth redirect cutover

**Inspect before changing anything:** `APP_ORIGIN`, `AUTH_REDIRECT_ORIGIN`,
`lib/auth/callback.ts`, `lib/auth/paths.ts`, `lib/security/request-origin.ts`,
and the Supabase Auth _Redirect URLs_ allow-list.

**Required changes, in this order:**

1. Add `https://admin.essqu.com/auth/callback` to the Supabase allow-list —
   **add, do not replace**, so live recovery links and active sessions keep
   working during the change.
2. Set `AUTH_REDIRECT_ORIGIN=https://admin.essqu.com` and
   `APP_ORIGIN=https://admin.essqu.com` on Core production. Both must match
   exactly; the origin guard fails closed on a mismatch.
3. Deploy and verify **before** removing the old origin.

**Verify — all four must pass before the old URL is retired:** login, logout,
password recovery (the emailed link must land on `admin.essqu.com` and complete),
and the signed-out redirect from `/admin/access`. Then confirm an
attacker-supplied `next` is still rejected (no open redirect).

**Do not expose Auth on `api.essqu.com`** — the host policy returns 404 for
`/auth/*` on the API host once enforcement is on.

**Rollback:** restore the previous values of both environment variables, redeploy,
and leave the old callback URL in the Supabase allow-list until the new one is
proven.

---

## E. Backup

Production DDL requires a verified managed recovery path. The authenticated
Supabase backup inspection on October 18 returned `backups: null`, empty
`physical_backup_data`, `pitr_enabled: false`, and `walg_enabled: true`; the
organization is on Free. These values do not establish an available restore
point. WAL archiving alone is insufficient evidence.

Have the owner enable or identify suitable managed recovery and record the
available restore point, retention and restoration procedure before applying
0024 to production. If that cannot be verified, leave production unchanged and
continue staging work. Do not silently substitute a local export of real attendee
data or infer readiness from historical logical-restore evidence. No new
production attendee export or backup has been taken in this pre-domain pass.

---

## Release order

`@

1. Core hardening deployed DONE
2. Core API code merged DONE
3. Production additive DB migration applied GATE A
4. Production API client created GATE B
5. api.essqu.com attached and verified GATE C
6. API verified independently (401 -> 200) after C
7. admin.essqu.com attached and verified GATE C
8. Auth redirect origins updated and verified GATE D
9. Landing production receives base URL + key after B and C
10. essqu.com landing deploys API integration Landing team
11. Cross-project smoke test after 10
12. Observe logs and errors ongoing
13. Retain rollback capability always
    `@

## What must never happen

Do not give the Landing project `DATABASE_URL`,
`APP_RUNTIME_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or any Core admin
credential. Do not put the API key in `NEXT_PUBLIC_*`. Do not grant
`app_runtime` table DML. Do not weaken RLS. Do not run `supabase db push`
against production. Do not create fake production registrations to prove the
endpoint.
