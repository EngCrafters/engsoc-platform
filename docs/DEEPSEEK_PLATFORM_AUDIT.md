# DeepSeek Platform Audit — Engineering Society Platform

**Audit type:** read-only architectural review (Staff/Principal level)
**Repository:** `C:\Users\salim\Projects\engsoc-platform`
**HEAD audited:** `a0f8ffbfd40ac8208cad9b2445c3e31b0239ec82` (`main`, tree clean, up to date with `origin/main`)
**Remote:** `https://github.com/EngCrafters/engsoc-platform.git`

> **Read-only guarantee.** No application source, migration, schema, CI workflow,
> Supabase setting, Vercel setting, or production datum was modified by this
> audit. The only writes were the audit documents in `docs/`. No migration was
> applied. No destructive git command was run. No secret value is reproduced.

---

## 0. Executive summary

This is a **genuinely well-engineered small platform**, not a prototype that
drifted into production. Its distinguishing property is that authorization is
enforced **three times over** — in the route layout, in every server action, and
again inside `SECURITY DEFINER` PostgreSQL routines that re-read current grants
on every call. The most commonly claimed-but-absent control in systems of this
size — "the database is the security boundary" — is here actually true: the
runtime role `app_runtime` holds **zero direct table privileges in any schema**,
verified in the DDL, and reaches data only through 28 granted routines.

The audit found **no Critical and no High open runtime security defect**. The
highest-severity findings are operational and environmental rather than
exploitable.

| #    | Finding                                                                                                                                                                                                                    | Severity                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| F-01 | `scripts/m7-staging-browser-smoke.ts` is **write-capable** (INSERT/DELETE), targets by `--linked`, and the local Supabase link points at the **production** project. Only an explicit `--project-ref` keeps it on staging. | High (latent/operational) |
| F-02 | The mandatory `npm run test` gate **throws at import** without `STAGING_SUPABASE_*`, coupling release validation to a live third-party project.                                                                            | Medium                    |
| F-03 | A long-lived staging anon JWT is **committed** at `.github/workflows/ci.yml:58`.                                                                                                                                           | Medium (public-by-design) |
| F-04 | The actor identity passed into every `private.*` routine is a **server-supplied uuid** that PostgreSQL trusts unverified.                                                                                                  | Medium                    |
| F-05 | Rate-limit subject is `x-vercel-forwarded-for`, a request header.                                                                                                                                                          | Medium                    |
| F-06 | `npm run build` **fails on a clean clone** without `APP_RUNTIME_DATABASE_URL`.                                                                                                                                             | Low (DX)                  |
| F-07 | `npm run format:check` **fails on every file** on Windows (`core.autocrlf=true`, no `.gitattributes`).                                                                                                                     | Low (DX)                  |
| F-08 | `resend` npm dependency is **never imported**.                                                                                                                                                                             | Low                       |
| F-09 | Dev-dependency advisories deferred (15 packages, several High).                                                                                                                                                            | Low (documented)          |

**Final recommendation: CORE ARCHITECTURE UNDERSTOOD — READY FOR MIGRATION DESIGN.**
The architecture is legible, the security model is real and testable, and the
boundaries are documented well enough to design a migration against. The
blockers that remain are _owner decisions_ and _local environment gaps_, not
architectural uncertainty.

---

## 1. Scope, method and limitations

DISCOVER → INVENTORY → READ DOCUMENTATION → MAP ARCHITECTURE → TRACE DATA FLOWS
→ TRACE AUTHORIZATION → INSPECT DATABASE → INSPECT TESTS → INSPECT CI/CD →
INSPECT EXTERNAL SERVICES → RUN SAFE VALIDATION → IDENTIFY RISKS/GAPS → DOCUMENT.

Evidence was gathered by reading source directly and by running safe, read-only
commands. Findings from four parallel deep-dive passes were **re-verified
first-hand** before being reported.

### Verified first-hand

- Full file inventory (326 tracked-ish files excluding build directories).
- Every module under `lib/`; every route handler and server action under `app/`.
- `db/index.ts`; all 24 migrations via extraction of `GRANT`/`REVOKE`,
  `CREATE POLICY`, `SECURITY DEFINER`, `search_path` and RLS statements, plus full
  reads of `0004` (RLS/policies), `0016` (access hierarchy), `0022` (JWT claims).
- `.github/workflows/ci.yml`, both git hooks, all five `scripts/`.
- Live read-only HTTP probes of `https://engsoc-platform.vercel.app`.
- Read-only GitHub API calls (`gh run list`, `gh api`).
- `npm ci`, `format:check`, `lint`, `db:check`, `typecheck`, `git diff --check`, `build`.

### Limitations (stated honestly)

| Limitation                                                                    | Consequence                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `.env.local` contains **only** `VERCEL_OIDC_TOKEN` — no Supabase credentials. | `npm run build` fails locally; `npm run test` cannot complete; no direct database inspection was possible.          |
| No Vercel CLI installed.                                                      | Deployment state verified indirectly (GitHub deployments API + live HTTP), not via `vercel inspect`.                |
| No `psql` client and no DB credential.                                        | The schema map derives from the migration chain — authoritative for _intended_ state, not proof of _applied_ state. |
| No authenticated production browser session.                                  | Admin UI behaviour was read from source, not exercised live.                                                        |

**Explicitly not claimed:** that the _applied_ production database matches the
repository migration chain. `docs/UC-02_Data_and_Security.md` ("The migration
chain and live catalog, rather than this design document alone, establish
deployed state") is the correct posture and this audit adopts it.

---

## 2. Environment status (Phase 1)

| Component         | Found                                                                             | Assessment                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows           | Windows 11 Home, build 26200                                                      | OK                                                                                                                                                   |
| PowerShell        | **Windows PowerShell 5.1.26100.9444**                                             | **Not PowerShell 7.** `-SkipHttpErrorCheck` and other PS7-only parameters are unavailable.                                                           |
| Git               | 2.56.0.windows.2                                                                  | OK                                                                                                                                                   |
| GitHub CLI        | 2.102.0, authenticated as `EngCrafters` (scopes `gist, read:org, repo, workflow`) | OK                                                                                                                                                   |
| Node              | v24.21.0                                                                          | **Drift:** CI pins Node **22** (`ci.yml:34`).                                                                                                        |
| npm               | 11.19.0 — **only via `npm.cmd`**                                                  | `npm.ps1` blocked by execution policy; bare `npm ...` fails with `UnauthorizedAccess`.                                                               |
| Lockfile          | `package-lock.json` (551 KB) → **npm**                                            | Matches; no pnpm/yarn lockfile.                                                                                                                      |
| Docker            | 29.8.2 (Docker Desktop), daemon **running**, 0 containers                         | OK — required by `tests/db` and `tests/e2e`.                                                                                                         |
| Vercel CLI        | **not installed**                                                                 | Blocks independent deployment verification.                                                                                                          |
| Supabase CLI      | project-local via `npx supabase` → **2.120.0**                                    | As instructed. **No global `supabase` executable** — `scripts/m7-staging-browser-smoke.ts` calls `(Get-Command supabase).Source` and will fail here. |
| PostgreSQL client | `psql` not installed                                                              | See limitations.                                                                                                                                     |
| `node_modules`    | **absent on arrival**; installed during this audit with `npm ci` (795 packages)   | New-laptop reproduction of dependency install confirmed.                                                                                             |

**Versions derived from the repository, not guessed:** Node `22` (CI),
`postgres:17-alpine` (test harness), Next `16.3.6`, React `19.2.8`.

---

## 3. Repository status (Phase 2)

```
branch            main
HEAD              a0f8ffbfd40ac8208cad9b2445c3e31b0239ec82
upstream          origin/main — "up to date"
working tree      clean
remote (origin)   https://github.com/EngCrafters/engsoc-platform.git
visibility        private
default branch    main
```

### Path discrepancy (corrected)

The task brief names `C:\Projects\engsoc-platform`. **That path does not exist.**
The canonical checkout is `C:\Users\salim\Projects\engsoc-platform`. There is
exactly one candidate repository and its remote matches
`EngCrafters/engsoc-platform`, so this is a path-statement error rather than a
canonical-repository ambiguity; the audit proceeded against the real checkout.

### Untracked user-managed paths

`.agents/`, `.codex/` and `skills-lock.json` **are not present** in this checkout —
nothing to preserve. `.claude/` is partially tracked. `.env.local` and `.vercel/`
exist and are correctly gitignored.

### Last 15 commits (newest first)

```
a0f8ffb docs: record production CSV export verification
749cdc5 fix(security): preserve native CSV export origin and validate canonical site
258450e chore(security): diagnose rejected export origins without sensitive data
5dc09cb docs: reconcile final lifecycle verification evidence
730edd7 docs(access): record lifecycle rollout and remaining pilot
f2312a9 feat(access): formalize manager replacement and identity retention
9f56ee4 docs: record verified production closure and owner gates
f374255 fix(auth): reconcile partial administration and readiness evidence
d64b505 fix(ci): use disposable runtime URL in browser build
f8e44de docs: reconcile access and email operations after audit
930d91d fix(security): harden runtime boundaries and CI gates
b4bba16 fix(access): read JWT claims so signed-in admins see their committees
de0a1c1 feat(auth): fix password recovery and add Technical user administration
a6c1c86 docs: clarify production password recovery flow
c97cae8 docs(auth): keep recovery on the account holder device
```

Commit discipline is genuinely enforced, not aspirational: `.husky/commit-msg`
runs `commitlint`, and CI job 2 re-validates the whole pushed range.

### Linked external projects (identifiers only — no secrets)

| Service                                                 | Identifier                                               |
| ------------------------------------------------------- | -------------------------------------------------------- |
| Supabase (locally linked, `supabase/.temp/project-ref`) | `rbeyqrfypowyocmnmvwu` — **the production/main project** |
| Supabase staging (per docs and `ci.yml:57`)             | `wnrdgnmmcdedmilnzzsl`                                   |
| Vercel project (`.vercel/repo.json`)                    | `engsoc-platform`, team `team_7D7N5RjtGcGiZxVkRQCcUIRe`  |
| Supabase Postgres version                               | 17.6.1.166                                               |

---

## 4. Architecture overview

### Stack (verified from `package.json`)

Next.js `16.3.6` (App Router) · React `19.2.8` · TypeScript `^5` · Tailwind `^4` ·
shadcn/ui (`style: radix-nova`, `baseColor: neutral`) · Radix `^1.6.7` · Lucide ·
Geist · `motion` · `three` (auth mascot only) · Drizzle ORM `^0.45.2` +
`postgres` `^3.4.9` · Supabase Auth via `@supabase/ssr` `^0.12.7` ·
Resend (SMTP configured in Supabase — **not** the npm package).

### The single most important architectural fact

The application **never writes to a table directly**. `db/index.ts` connects as
`app_runtime`, and the DDL confirms that role holds _no_ table privileges:

> `0004_uc02_security_foundation.sql:79-80` — "app_runtime (what the Next.js
> server connects as) gets NO direct table grants at all — only EXECUTE on the
> fixed routines below."

Every `... TO app_runtime` statement across all 24 migrations is either
`GRANT USAGE ON SCHEMA` or `GRANT EXECUTE ON FUNCTION`. This was verified by
enumerating all 128 `GRANT`/`REVOKE` statements in `db/migrations/`.

### Three-layer authorization

| Layer               | Mechanism                                                                                                            | Example                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Route/layout     | `getManagerContext()` in the protected layout; `redirect()` on anonymous                                             | `app/admin/(protected)/layout.tsx`                                               |
| 2. Server action    | Every action re-resolves the actor and re-checks `accessLevel` before touching data                                  | `requireTechnical()` in `app/admin/(protected)/access/user-actions.ts`           |
| 3. Database routine | `SECURITY DEFINER` routine re-reads `administrative_access` under `FOR SHARE`, returns `NOT_FOUND`/denied on failure | `private.lock_committee_access`, `private.can_access_committee` (`0016:102-155`) |

Layer 3 is the authorization boundary. Layers 1–2 are UX and defense in depth.

### Verified positive controls

- **No direct table DML for the runtime role** — verified in DDL.
- **All 69 `SECURITY DEFINER` functions pin `SET search_path = public, pg_temp`**; no `SECURITY INVOKER` function exists.
- **`EXECUTE` revoked from `PUBLIC` per function** and granted narrowly: `anon`/`service_role` have **none**; `authenticated` has exactly one (`private.can_access_own_committee`); `app_maintenance` has exactly one (`private.set_technical_access`).
- **RLS enabled _and forced_ on all ten public tables** plus `private.uc02_audit` (`0006:6-25`). Tables without policies are default-deny.
- **CSRF/origin validation fails closed** — `lib/security/request-origin.ts` requires an exact `Origin` match against server-only `APP_ORIGIN`; a present `Referer` must also match. Missing/opaque(`null`)/malformed/foreign origins are rejected.
- **Open-redirect protection** — `lib/auth/paths.ts` restricts post-auth redirects to internal `/admin` paths, rejecting absolute, protocol-relative and backslash paths.
- **CSV formula-injection defense present and tested** — `lib/admin-registrations/csv.ts` prefix-escapes `=`, `+`, `-`, `@`, tab, CR, LF (including after leading whitespace) and quotes every cell.
- **Secrets never reach the browser** — `SUPABASE_SERVICE_ROLE_KEY` is read in exactly one module (`lib/auth/admin.ts`, which is `import "server-only"`); there are no secret `NEXT_PUBLIC_*` variables.
- **Security headers confirmed live in production** — CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, HSTS `max-age=63072000; includeSubDomains; preload`, and `x-powered-by` absent (`next.config.ts` `poweredByHeader: false`).
- **Dev-only route is not shipped** — `/dev/design-system` returns **404** in production (verified live) via an explicit `NODE_ENV === "production"` `notFound()` guard.
- **Unauthenticated admin boundary works in production** — `/admin/access` and `/admin/events` both return **307 → `/admin/login?next=/admin/events`**.

---

## 5. Security findings

Classified Critical / High / Medium / Low / Informational. **No Critical found.**

### F-01 — `m7` smoke script is write-capable and its target is chosen by `--linked` — **High (latent, operational)**

**Evidence.**

- `scripts/m7-staging-browser-smoke.ts:26` invokes
  `& $supabase db query --linked --project-ref wnrdgnmmcdedmilnzzsl --output-format json --file ...`
- The script **writes**: `seed()` INSERTs into `public.events`,
  `public.registrations` (26 rows), `public.committees`; `cleanup()` DELETEs from
  `private.uc02_audit`, `public.registrations`, `public.events`, `public.committees`.
- `supabase/.temp/project-ref` in this checkout is `rbeyqrfypowyocmnmvwu` — the
  **production** project.
- The script drives `https://engsoc-platform.vercel.app` (line 15) — **production** —
  while the fixtures are written to **staging**.

**Impact.** If `--project-ref wnrdgnmmcdedmilnzzsl` is removed, mistyped, or ignored,
the INSERT/DELETE statements execute against **production business data**,
including `DELETE FROM private.uc02_audit` — the append-only audit trail.
`--linked` alone resolves to production.

**Mitigating facts (verified).** (a) The explicit flag is present. (b) The script is
**already broken**: it references `public.committee_managers`, renamed to
`public.administrative_access` by `0016:51`, so `seed()` fails before writing
anything on any project at 0016+. (c) It requires `STAGING_M5_MANAGER_EMAIL`/
`_PASSWORD`, absent from `.env.local`. (d) It calls a **global** `supabase`
executable that does not exist here.

**Recommendation.** Delete as superseded M7 evidence, or convert to a hard-fail
design: assert an explicit project ref **and** assert the resolved ref is not
`rbeyqrfypowyocmnmvwu` before any write. Never rely on `--linked`.

### F-02 — The mandatory test gate throws without third-party staging credentials — **Medium**

**Evidence.** `tests/rls-staging-anon.test.ts:30-37` throws at module scope when
`STAGING_SUPABASE_URL`/`STAGING_SUPABASE_ANON_KEY` are unset. It is a **throw, not
a skip**, so the whole `npm run test` run fails. This checkout's `.env.local` has
neither.

**Impact.** The single command that proves the security model cannot run from a
clean clone; release validation is coupled to the availability and current seed
data of a live third-party project. The test also pins two staging row UUIDs and
concedes "If staging ever gets re-seeded, update these to match."

**Recommendation.** Convert the module-level throw to `describe.skipIf`, or move
the suite behind an explicit opt-in script, so the default gate is hermetic.

### F-03 — Long-lived staging anon JWT committed to the repository — **Medium (public-by-design)**

**Evidence.** `.github/workflows/ci.yml:55-58` contains a literal
`STAGING_SUPABASE_ANON_KEY` JWT (project ref `wnrdgnmmcdedmilnzzsl`, `"role":"anon"`,
`"exp":2104889309` ≈ 2036) with the comment "Public by design (the anon key,
protected by RLS, not secrecy)."

**Assessment.** The reasoning is **correct** — a Supabase anon key ships to
browsers by definition, and this platform's model explicitly relies on RLS and
grants rather than key secrecy. This is therefore not a secret leak. It is
reported because (a) a decade-long credential in VCS will be flagged by any
scanner and by future maintainers, and (b) rotating the staging anon key requires
a code change and a push.

**Recommendation.** Move to a repository variable/secret and document it as
non-sensitive, or add a comment naming the project and what rotation entails.

### F-04 — Database routines trust a server-supplied actor UUID — **Medium (documented trade-off)**

**Evidence.** Every mutating routine takes `p_actor uuid` and uses it directly for
authorization, e.g. `private.lock_committee_access(p_actor, p_committee)`
(`0016:124-137`). The migration states the assumption at `0016:99-101`:

> "One policy helper is used by authenticated RLS and every admin routine. The
> caller identity supplied to private routines is verified by the server;
> browser RLS always supplies auth.uid(), never a client-controlled user id."

**Impact.** Authorization is correct _given_ that the server always passes the
session user's real id — which the code does, always via `getManagerContext()` →
`supabase.auth.getUser()`. But anything able to execute a routine as
`app_runtime` (i.e. holding `APP_RUNTIME_DATABASE_URL`, which includes any
server-side RCE) can impersonate **any** actor, including Technical, by passing
that user's UUID. Browser RLS is unaffected (it uses `auth.uid()`).

**Recommendation.** Treat as an accepted, documented boundary. If the migration
increases the number of credential holders, consider binding identity via
`current_setting('request.jwt.claims')` inside the routines instead of a parameter.

### F-05 — Rate-limit identity derives from a request header — **Medium (scoped by ADR 0005)**

**Evidence.** `app/(marketing)/actions.ts` reads
`headersList.get("x-vercel-forwarded-for")` and trusts it with no signature
check; `tests/e2e/README.md` confirms this is intentional. In non-development
without the header, every request collapses into the single bucket `"invalid"`.

**Assessment.** `docs/adr/0005-registration-rate-limiting.md` already scopes this
honestly as "not meant to stop a determined attacker… meant to stop naive
scripted spam and accidental double-submits." Registration is public by design;
the database enforces the real invariants (duplicate index, capacity under row
lock). Residual risk is nuisance spam.

**Recommendation.** No urgent change. Note for migration: on a non-Vercel host the
header becomes fully client-controlled and the limiter degrades to bypassable or
globally shared.

### F-06 — `npm run build` fails on a clean clone — **Low (developer experience)**

**Reproduced.** `npm run build` exits 1:

```
Error: Failed to collect configuration for /
  [cause]: Error: APP_RUNTIME_DATABASE_URL is required for runtime database access.
```

`db/index.ts` throws at module load when the variable is unset, and Next.js
evaluates route modules during "Collecting page data." CI works around this with
a placeholder (`ci.yml:68`). Fail-closed at runtime is correct, but the production
build is non-hermetic: no artefact without a (possibly fake) database URL.

**Recommendation.** Document the prerequisite in the README getting-started
section (currently absent), or defer client construction so the build does not
require runtime credentials.

### F-07 — `npm run format:check` fails on every file on Windows — **Low (developer experience)**

**Reproduced.** `FORMAT_EXIT=1`; prettier emits `[warn]` for essentially every
tracked file. Root cause verified: `git config core.autocrlf` = `true`, the
repository has **no `.gitattributes`**, so the working tree holds CRLF while git
stores LF. Measured: `README.md` = 129 CRLF / 0 bare LF; `package.json` = 66 CRLF
/ 0 bare LF. Prettier defaults to `endOfLine: "lf"` and `.prettierrc.json` does not
override it.

**Impact.** A required, CI-gated quality gate produces a **false failure** on a
fresh Windows clone, inviting a whole-repository `prettier --write` diff. CI on
`ubuntu-latest` is unaffected, which is why it has gone unnoticed.

**Recommendation.** Add `.gitattributes` with `* text=auto eol=lf` (and
`*.png binary`), or set `"endOfLine": "auto"` in `.prettierrc.json`.

### F-08 — Unused production dependency — **Low**

`resend` (`^6.28.0`) is declared in `dependencies` but **imported nowhere** —
verified by enumerating every `resend` occurrence in `app/`, `lib/`,
`components/`, `hooks/`, `db/`, `scripts/`, `tests/`: all are the application's own
`resendAuthInvitation` / `resendInvitationAction` identifiers. `.env.example`
documents `RESEND_API_KEY` as "Reserved for future application-originated
transactional email," so this is deliberate. Impact is install-surface and
supply-chain only. Recommend removing until used.

### F-09 — Development dependency advisories deferred — **Low (documented)**

`docs/HARDENING_AUDIT_2026-10-07.md` records 15 dev/CI advisories (several High:
`@modelcontextprotocol/sdk`, `@next/eslint-plugin-next`, `@ts-morph/common`,
`brace-expansion`, `braces`, `eslint-config-next`, `fast-glob`, `micromatch`,
`shadcn`, `ts-morph`), all dispositioned "Defer," with the rationale that they are
absent from the production request audit and that npm's suggested major
downgrades are unsafe. The same document later records **one High-severity
Next.js package entry** superseding an earlier "zero advisories" claim. This audit
**agrees with the deferral** for dev tooling and did not run
`npm audit fix --force`.

### F-10 — Informational observations

- **No application-level login rate limiting.** Delegated entirely to Supabase Auth.
- **Leaked-password protection disabled**, plan-gated (Supabase returned HTTP 402).
- **Auth Admin mutation and DB audit are separate transactions.** Creating a user via
  the Supabase Admin API and writing its audit row are two calls
  (`app/admin/(protected)/access/user-actions.ts` `audit()`); a failure between them
  leaves an unaudited Auth mutation. Explicitly acknowledged in ADR 0014 and the
  hardening audit; a five-step reconciliation procedure exists in the runbook, and
  the code emits a secret-free `auth_admin_audit_failed` log.
- **No user-ID-only session invalidation.** `auth.admin.signOut` requires the target
  session JWT, which the application deliberately does not collect. Live grants
  remain the authorization boundary, so a stale token confers no access — but it can
  outlive offboarding.
- **`registration_attempts` grows unbounded.** No cleanup routine, no `pg_cron` job.
  ADR 0005 flagged this at design time; `app_maintenance` holds `DELETE` as the
  manual remedy.
- **A single `app_maintenance` credential can bootstrap Technical access** — intentional
  recovery path, used for the production bootstrap. It is the highest-value
  credential in the system.
- **`.env.example` is complete and well-annotated**, naming every variable with its
  trust level and stating that `DATABASE_URL` is migration-only and never a runtime
  fallback.

---

## 6. Maintainability findings

### Strengths

- **Documentation depth is exceptional for this project size**: 14 ADRs, three UC-02
  companion documents, an access-control contract, a design-system spec, a
  maintenance runbook and a dated hardening audit. ADRs record _rejected_
  alternatives and their reasoning — exactly what a migration needs.
- **Module READMEs exist for every domain module** (`lib/events`, `lib/registrations`,
  `lib/auth`, `lib/access`, `lib/admin-events`, `lib/admin-registrations`,
  `components/admin`, `components/auth`, `db`, `tests/db`, `tests/e2e`), each stating
  what the module owns and what must not be done.
- **Zero TODO/FIXME/HACK/XXX markers** in the entire source tree (grep-verified).
- **Zero `any` types, zero `@ts-ignore`/`@ts-expect-error`/`eslint-disable`** in
  application code (grep-verified). `strict: true`.
- **Consistent error vocabulary**, mapped centrally (`lib/admin-errors.ts`,
  `lib/access/messages.ts`, `app/admin/(protected)/access/user-state.ts`) with tests
  asserting no SQL/provider text leaks (`tests/admin-errors.test.ts`).
- **Import discipline is real** — domain modules are imported only through `index.ts`.

### Gaps

| #    | Gap                                                                                                                                                                                                                    | Evidence             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| M-01 | **Documentation is internally contradictory and does not self-reconcile.** Ten items catalogued in §9.                                                                                                                 | documentation review |
| M-02 | **No `.gitattributes`**; Windows contributors hit F-07.                                                                                                                                                                | verified             |
| M-03 | **README getting-started omits the runtime DB prerequisite** that `build` and `test` both require.                                                                                                                     | F-06                 |
| M-04 | **Stale scripts are not marked stale.** `scripts/m7-staging-browser-smoke.ts` references `public.committee_managers` (renamed by `0016:51`) and a global `supabase` binary that does not exist here.                   | F-01                 |
| M-05 | **No on-call/ownership section.** No escalation path, incident commander, response target or named owner — only role categories.                                                                                       | runbook review       |
| M-06 | **Migration rollback documented but never executed on production.**                                                                                                                                                    | runbook              |
| M-07 | **`npm run test` cannot run without Docker even for pure unit tests** — `vitest.config.mts:27` attaches the DB `globalSetup` unconditionally and `fileParallelism: false` serialises everything.                       | `vitest.config.mts`  |
| M-08 | **`admin/(protected)/access/page.tsx` renders an inline `<p role="alert">`** for non-Technical callers rather than redirecting/404ing — inconsistent with the rest of the surface, though the database still enforces. | source               |

---

## 7. Scalability findings

The architecture is **structurally sound**; there is no N+1 pattern and no
unbounded read on a hot public path. Bottlenecks are deliberate and bounded.

| Area                    | Behaviour                                                                                                                                                                         | Assessment                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Public event list       | Cursor-paginated, 20/page, one routine call (`private.list_public_events`), `dynamic = "force-dynamic"`, partial index `events_public_discovery_idx`                              | Scales well                                                                                                            |
| Public event detail     | Single routine; malformed id short-circuits before the DB                                                                                                                         | Scales well                                                                                                            |
| Registration write      | One routine; `FOR UPDATE` on the event row serialises seat allocation; a transaction advisory lock **per IP** (`pg_advisory_xact_lock(hashtext(p_ip::text))`) serialises attempts | Correct by design; the event row lock is the natural contention point for a popular event                              |
| Admin event list        | Cursor-paginated, 20/page, filters pushed into PostgreSQL with an `(event_date, id)` cursor                                                                                       | Scales well                                                                                                            |
| Counts                  | Recomputed per request by `private.count_admin_events` / `count_admin_registrations`                                                                                              | Fine at society scale; first cost as event count grows                                                                 |
| Registrations list      | Cursor-paginated, 25/page                                                                                                                                                         | Scales well                                                                                                            |
| Export                  | Bounded: **10 000 rows / 10 MiB**, single snapshot, count re-verified, mismatch → 409 rather than a partial file                                                                  | Well designed                                                                                                          |
| Access directory        | `private.list_auth_directory` returns **all** Auth users unpaginated                                                                                                              | **First real limit.** The hardening audit itself says "review at 200 identities. Do not claim an existing hard bound." |
| Access audit            | `LIMIT 100`; user audit `LIMIT 50`                                                                                                                                                | Adequate, but truncation is silent                                                                                     |
| `registration_attempts` | Unbounded growth                                                                                                                                                                  | Needs a purge job before volume matters                                                                                |
| Connections             | `max: 1` per warm serverless instance, `prepare: false` for the transaction pooler, TLS required except loopback                                                                  | Correct for Vercel + Supabase pooling                                                                                  |
| Client hydration        | 44 client components; `three` loaded lazily only for the auth mascot                                                                                                              | Reasonable; the mascot is the largest optional client cost                                                             |

**Structural scaling risks, in the order they would bite:**

1. **Auth directory without pagination** (~200 users).
2. **Unbounded `registration_attempts`.**
3. **Per-request count aggregation** on the admin dashboard.
4. **Single-committee-per-user PK** means a manager can never cover two committees;
   growth is handled by adding managers, not widening scope — a deliberate policy,
   not a limitation.

---

## 8. Operational findings

### Proven vs merely documented

| Capability                                   | Status                                                                                                                                     | Evidence        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Backup / restore (manual snapshot)           | **Proven once** — `pg_restore --exit-on-error` into a disposable PG 17.6 instance                                                          | hardening audit |
| Point-in-time recovery                       | **Not available** — PITR disabled; WAL archiving enabled but no listed physical backups or retention window                                | hardening audit |
| Automated backup                             | **Absent**                                                                                                                                 | hardening audit |
| Timed disaster-recovery objective (RTO/RPO)  | **Not established** — explicitly disclaimed                                                                                                | runbook         |
| Migration rollback on production             | **Never executed** — documented only                                                                                                       | runbook         |
| Credential rotation                          | **Proven once** (Oct 7: new credential succeeded, old failed `28P01`, 824-blob scan clean)                                                 | hardening audit |
| Email delivery                               | **Proven** — Resend reports "delivered"; owner-confirmed recovery pilot PASS                                                               | hardening audit |
| Vercel production deploy                     | **Proven** — independently confirmed in this audit via GitHub deployments API (`a0f8ffb` → Production, 2026-10-08T11:00:16Z) and live HTTP | this audit      |
| Security headers in production               | **Proven** — live HTTP probe                                                                                                               | this audit      |
| Unauthenticated admin boundary in production | **Proven** — `/admin/access` and `/admin/events` → **307 → `/admin/login?next=/admin/events`**                                             | this audit      |
| Dev route excluded from production           | **Proven** — `/dev/design-system` → **404**                                                                                                | this audit      |
| Vercel log access via configured connector   | **Broken** — 403 (missing team scope); owner's CLI works                                                                                   | runbook         |
| Supabase connection/statement logging        | **Limited** — connection logging off, DDL-only statement logging, no pgAudit                                                               | runbook         |
| On-call / incident ownership                 | **Not documented**                                                                                                                         | runbook review  |

### CI/CD as observed

- Triggers: `push` to `main` and `pull_request` → `main` (`ci.yml:6-10`).
- Job 1 `lint-and-build`: `npm ci` → `format:check` → `lint` → `db:check` →
  `typecheck` → `npm run test` → `npm run build` → `playwright install` →
  `playwright test`, on Node 22 with a `postgres:17-alpine` service container.
- Job 2 `commitlint`: validates the pushed commit range.
- **No `concurrency` group, no path filters, no secrets references anywhere.**
- The Playwright step has **no `env:` block**, so e2e starts its **own** Docker
  container instead of using the CI service container — extra minutes, not a
  correctness problem.
- `tests/db/backup-restore.test.ts` uses `describe.skipIf(!container)` and therefore
  **always skips in CI** (where `TEST_DATABASE_URL` is set): the restore rehearsal is
  never exercised by CI.
- Deployment is Vercel's GitHub integration; a push to `main` is production.
- Branch protection is **not available** on this plan (GitHub returned HTTP 403:
  "Upgrade to GitHub Pro or make this repository public"); `security_and_analysis`
  reports `secret_scanning`, `push_protection` and `dependabot` as `null`. For a
  **private, free-tier** repository that means no enforced review gate and no
  platform secret scanning — the repository relies entirely on CI plus the
  `.husky` hooks.

---

## 9. Architectural inconsistencies and documentation drift

These are **documentation** defects, not code defects. They matter for migration
because a migration team reading the docs would be misled.

| #    | Inconsistency                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Reviewer authority stated two ways        | ADR 0012 and `UC-02_Deep_Dive.md` §11 give approval to a different **BOARD_ADMIN or TECHNICAL** user and bar managers; but `UC-02_Deep_Dive.md` P12 (line 88) and lines 491-494 still record the older "two managers on the same committee" answer and "Board participants are not a separate role… There is no global board override." `UC-02_Data_and_Security.md:218, 236-239` still grants approval to the "owning manager." **The code implements ADR 0012**: `approve_event`/`reject_review` require BOARD_ADMIN/TECHNICAL, and `app/admin/(protected)/events/actions.ts` returns `GLOBAL_ACCESS_REQUIRED` for a manager. |
| D-02 | Whether the access model is applied       | `UC-02_Deep_Dive.md:6-8` says the manager-only clauses are superseded "and its migration is applied"; `UC-02_Data_and_Security.md:6-8` says those sections "describe the deployed manager-only baseline **until** the new migration is applied." Both cannot be current.                                                                                                                                                                                                                                                                                                                                                        |
| D-03 | Migration head stated three ways          | `UC-02_Release_Notes.md:4-5` says "through 0015"; `Platform_Maintenance_Runbook.md:162` says "through 0022"; `HARDENING_AUDIT_2026-10-07.md:278-279` says `0023` is applied as version `20261007090000`. The repository contains 24 migrations (`0000`–`0023`).                                                                                                                                                                                                                                                                                                                                                                 |
| D-04 | Support-manager state stated two ways     | `Platform_Maintenance_Runbook.md:155-156` says Support/Finance/Media "each have one live assignment"; `CURRENT_WORK.md:17-21` says the disposable Support test identity "has been revoked and retains no application access," and the hardening audit lists the real Support manager as **pending**.                                                                                                                                                                                                                                                                                                                            |
| D-05 | RLS table count                           | Hardening audit says "nine public business tables" in one place while other docs say "ten UC-02 tables." Reconciliation: the code enables **and forces** RLS on **ten** public tables (`0006:6-25`) plus `private.uc02_audit`; the "nine" figure excludes one without saying which.                                                                                                                                                                                                                                                                                                                                             |
| D-06 | A57 acceptance criterion tagged "blocked" | `UC-02_Acceptance_and_Delivery.md:83` carries an undefined `blocked` marker while the M8 gate demands all A-IDs pass and later evidence claims the review flow passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-07 | Stale "NEXT EXACT TASK"                   | `CURRENT_WORK.md:222-227` still asks for the Technical/Board sign-in that `CURRENT_WORK.md:17-18` already records as owner-confirmed PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D-08 | Checked box with pending content          | `UC-02_Deep_Dive.md:532` marks "Legacy Events stays isolated" as `[x]` while the same line says "pending verified cleanup."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-09 | Test totals                               | 235 → 232 → 256 across documents; CI and local totals differ (254 in CI vs 256 locally) because two environment-dependent tests skip in CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-10 | Superseded ADR 0009 not marked current    | ADR 0009 is correctly marked "Superseded for application access by ADR 0012," but `UC-02_Data_and_Security.md:161-163` still asserts "No role enum with speculative board/super-admin roles," which ADR 0012 directly contradicts.                                                                                                                                                                                                                                                                                                                                                                                              |

---

## 10. Technical debt register

| ID    | Item                                                                                       | Severity                           | Owner               |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------- |
| TD-01 | `scripts/m7-staging-browser-smoke.ts` write-capable + production-adjacent + already broken | High                               | Engineering         |
| TD-02 | Non-hermetic test gate (staging credential throw)                                          | Medium                             | Engineering         |
| TD-03 | Committed long-lived anon JWT                                                              | Medium                             | Engineering         |
| TD-04 | Server-supplied actor UUID trust boundary                                                  | Medium                             | Accepted / document |
| TD-05 | Documentation drift D-01…D-10                                                              | Medium                             | Engineering + Owner |
| TD-06 | No `.gitattributes` → format gate false failure on Windows                                 | Low                                | Engineering         |
| TD-07 | Non-hermetic build (runtime DB URL required at build)                                      | Low                                | Engineering         |
| TD-08 | Unused `resend` dependency                                                                 | Low                                | Engineering         |
| TD-09 | Unpaginated Auth directory                                                                 | Low now; Medium at ~200 identities | Engineering         |
| TD-10 | Unbounded `registration_attempts`                                                          | Low                                | Engineering         |
| TD-11 | `backup-restore.test.ts` permanently skipped in CI                                         | Low                                | Engineering         |
| TD-12 | Auth Admin mutation / audit non-atomicity                                                  | Low (accepted)                     | Accepted            |
| TD-13 | No on-call/ownership documentation                                                         | Low                                | Owner               |
| TD-14 | PITR disabled, no automated backups, no RTO                                                | Medium (recovery)                  | Owner               |

---

## 11. Blockers

### Blocking a _clean local reproduction_ (not blocking migration design)

| #    | Blocker                                                                                                                      | Effect                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| B-01 | **No Supabase credentials in `.env.local`** (only `VERCEL_OIDC_TOKEN`).                                                      | `npm run test` cannot complete (module throw); `npm run build` fails (runtime URL required). |
| B-02 | **No Vercel CLI** installed.                                                                                                 | Deployment state verified indirectly only.                                                   |
| B-03 | **No `psql`** client and no database credential.                                                                             | No independent verification of _applied_ production schema/RLS state.                        |
| B-04 | **Path statement mismatch** — brief says `C:\Projects\engsoc-platform`; actual is `C:\Users\salim\Projects\engsoc-platform`. | Informational; resolved by this audit.                                                       |

### Blocking _release_ (per the platform's own documents, not this audit's judgement)

| #    | Blocker                                                                                                                      | Source                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| B-05 | **The real Support manager identity has not been supplied, assigned, or piloted.** Declared the _sole_ remaining owner item. | hardening audit "Remaining findings"; `CURRENT_WORK.md:40-41` |
| B-06 | **The next use case must be explicitly chosen before UC-02 closes.**                                                         | `UC-02_Release_Notes.md:28-31`                                |

**Neither B-05 nor B-06 blocks migration _design_** — both are owner decisions
about scope and staffing. They do block declaring UC-02 closed.

---

## 12. Verification evidence log (this audit)

| Command                                              | Result                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` / `branch` / `remote -v` / `log -n 15`  | clean, `main`, `origin` = EngCrafters/engsoc-platform, up to date                                                                                                                                    |
| `npm ci --no-audit --no-fund`                        | **795 packages added.** Exit code reported as 1 by PowerShell only because npm writes deprecation warnings to stderr (native-command stderr is surfaced as an error). Not a failure.                 |
| `npm run format:check`                               | **EXIT 1** — every tracked file flagged (CRLF; F-07)                                                                                                                                                 |
| `npm run lint`                                       | **EXIT 0**                                                                                                                                                                                           |
| `npm run db:check`                                   | **EXIT 0** (4s)                                                                                                                                                                                      |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **EXIT 0** (30s)                                                                                                                                                                                     |
| `git diff --check`                                   | **EXIT 0**                                                                                                                                                                                           |
| `npm run build`                                      | **EXIT 1** — compiled successfully in 72s, TypeScript finished, then failed collecting page data: `APP_RUNTIME_DATABASE_URL is required for runtime database access` (F-06)                          |
| Production HTTP probes                               | `/` 200 · `/admin/access` 307→login · `/admin/events` 307→login · `/admin/login` 200 · `/dev/design-system` **404** · `/auth/reset` 200 — all security headers present                               |
| `gh run list`                                        | 6 most recent CI runs all `conclusion: success`; latest `37767106448` on `a0f8ffb`                                                                                                                   |
| `gh api .../deployments`                             | `a0f8ffb` Production 2026-10-08T11:00:16Z; `749cdc5` 10:54:06Z; `258450e` 10:45:08Z                                                                                                                  |
| `gh api .../branches/main/protection`                | **HTTP 403** — feature unavailable on this plan                                                                                                                                                      |
| Greps                                                | 0 `TODO/FIXME/HACK/XXX`; 0 `any`/`@ts-ignore`/`eslint-disable` in app code; 69 `SECURITY DEFINER`; 67 `search_path = public, pg_temp`; 19 `CREATE POLICY`; 33 RLS enable/force; 128 `GRANT`/`REVOKE` |

---

## 13. Conclusion

The Engineering Society Platform is a **small system built to a standard
considerably above its size**. Its authorization model is enforced where it
matters (the database), its secrets are server-side, its audit trail is
append-only by grant, its security headers are live, and its documentation —
despite the drift catalogued in §9 — is richer than most production systems ever
accumulate.

The findings that matter are **not** "the system is insecure." They are:

1. One stale, write-capable script pointed at production-adjacent tooling (F-01).
2. A test gate that is not hermetic (F-02).
3. A local environment that cannot reproduce the build or the test suite without
   credentials (B-01).

None of these prevents **designing** a safe migration. All three should be
resolved _before_ the migration executes.

**Final recommendation: CORE ARCHITECTURE UNDERSTOOD — READY FOR MIGRATION DESIGN.**
