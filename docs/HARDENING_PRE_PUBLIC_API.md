# Pre-public-API hardening (F-01 … F-09)

Branch: `hardening/pre-public-api`, cut from `main` at
`1194f462a2d7b45fbe102c343d20f5e9144fbe5b` (tag
`pre-api-architecture-2026-10-17`, tree
`96880767878a20259f0b3cdc6f107d97f784838e`).

The purpose of this pass is to make the restored Core safe and deterministic
_before_ it grows a new public network surface. Adding an HTTP API to a platform
whose build needs a fake credential, whose default test gate reaches a live
project, and which ships a write-capable production-adjacent script would mean
multiplying known defects.

| Finding                               | Status                        | Resolution                                                                  |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| F-01 production-adjacent smoke script | **Fixed**                     | Script deleted; reusable target guard added and tested                      |
| F-02 non-hermetic default tests       | **Fixed**                     | Default suite is hermetic; live staging moved to `npm run test:integration` |
| F-03 staging anon key in workflow     | **Fixed**                     | Moved to repository variables with a CI preflight                           |
| F-04 server-supplied actor UUID       | **Dispositioned**             | Accepted trusted-server boundary, ADR 0015                                  |
| F-05 client IP trust                  | **Fixed**                     | Single server-only resolver; spoofable headers refused                      |
| F-06 build requires fake DB URL       | **Fixed**                     | Lazy database initialization                                                |
| F-07 line endings                     | **Fixed**                     | `.gitattributes` pins LF, CRLF for Windows scripts                          |
| F-08 unused dependency                | **Fixed**                     | `resend` removed, lockfile regenerated                                      |
| F-09 dependency advisories            | **Reviewed, partly deferred** | Classification below                                                        |

## F-01 — the write-capable script is gone

`scripts/m7-staging-browser-smoke.ts` could write business rows and resolved
its database target through the Supabase CLI. In a normal checkout
`supabase/.temp/project-ref` points at **production**, so the script could land
on the live database through accidental linkage.

It had no callers, no package script and no documentation reference, so it was
**deleted rather than repaired**. The reusable guard that replaces ad-hoc string
checks lives in `scripts/lib/supabase-target.mjs`:

- `assertOperatorScriptTarget(connectionString, explicitRef)` — refuses an
  implicit target, refuses the production ref even when named deliberately,
  refuses a connection whose ref cannot be derived, and refuses a connection
  that disagrees with the declared ref;
- `assertProductionProjectTarget` — for read-only production checks that must
  name production on purpose;
- `assertNoImplicitLinkedTarget` — refuses `--linked`.

`tests/script-safety.test.ts` proves every refusal path, and additionally pins
the deletion itself: the file no longer exists and no package script references
it, so the hazard cannot quietly return.

## F-02 — the default suite is hermetic

`npm test` previously collected `tests/rls-staging-anon.test.ts`, which threw at
import when `STAGING_SUPABASE_URL` was absent. The result was that the _entire_
suite failed to load on a clean machine — 247 tests passed and one file failed —
even though only that one file needed the network.

Now:

- `vitest.config.mts` excludes `tests/integration/**`, so the default suite is
  hermetic: no network, no third-party credentials, just a disposable local
  Postgres container for the database suites;
- the live staging suites live in `tests/integration/` and run only through
  `npm run test:integration` (`vitest.integration.config.mts`);
- `tests/integration/global-setup.ts` **fails fast** with a clear message when
  the command is invoked without configuration. A green run full of silent skips
  would be a lie, and the command is explicit;
- `tests/integration/guard.ts` refuses a production target outright and skips
  every block if the ref is production, unknown, or missing.

Coverage is not reduced: the same assertions still run, now under an explicit
command, and CI runs them as their own gated step.

## F-03 — staging configuration is not workflow source

`STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` are now GitHub
repository **variables** (`vars.*`), not literals in `ci.yml`. An anon key is
public by design — RLS protects the data, not the key — so this is hygiene
rather than incident response: environment-specific values do not belong in a
file that is reviewed as code and forked by anyone.

A CI preflight step fails with an actionable message if either variable is
unset, so a missing configuration is a clear error rather than a confusing
auth failure.

## F-04 — see ADR 0015

Analysed and dispositioned rather than redesigned.

## F-05 — one resolver decides the client address

The IP is a **security input**: it keys the per-IP limiter inside
`private.register_for_event`. It was inlined in one Server Action; a second call
site over HTTP would have meant two definitions of a security boundary.

`lib/client-ip/server.ts` is now the only place that decides:

- it reads **only** `x-vercel-forwarded-for`, the header Vercel sets at its own
  edge. `x-forwarded-for`, `x-real-ip`, `forwarded`, `true-client-ip`,
  `cf-connecting-ip`, `fastly-client-ip` and `x-client-ip` are named in
  `IGNORED_IP_HEADERS` and each is proven not to be trusted;
- a forwarded _list_ is never collapsed into a made-up address;
- `203.0.113.7:4432` and `[2001:db8::1]:443` normalise; anything `net.isIP`
  rejects returns `null`;
- development and test get the documented loopback, matching previous behaviour;
- production fails closed when the header is missing rather than inventing an
  address;
- there is no parameter for a body, query string or override, so a public route
  cannot pass one through even by mistake.

**Honest limitation.** Vercel's documentation pages are client-rendered and
could not be read back in the session that wrote this module, so the
edge-overwrite property is _not_ re-verified here. It rests on the project's
October 2026 audit and on production traffic always having carried it. This is a
**platform-specific, tracked assumption**, not a proven invariant. It is
recorded as such in the module, and it fails closed — which is the right failure
direction. Defense in depth still holds regardless: the database limiter, the
partial unique index on active registrations, and per-event/email semantics are
all enforced in PostgreSQL.

## F-06 — the build no longer needs a fake credential

`db/index.ts` constructed the Postgres client at module scope, so _importing_ it
required a real credential. Next.js evaluates server modules while collecting page
data during `next build`, so a clean build failed with
`APP_RUNTIME_DATABASE_URL is required` even for routes that never touch the
database — and Vercel Preview, which intentionally has no runtime database, could
not compile without a placeholder URL.

`db` is now a proxy over lazily-created state:

- importing the module does nothing but declare it;
- the credential is checked, and the connection opened, on the first genuine
  database operation;
- fail-closed behaviour is preserved, just moved to the call;
- **there is still no fallback to `DATABASE_URL`** — that credential can perform
  DDL and bypass the `app_runtime` grants, so using it at runtime would defeat
  the entire security model;
- `tests/db-runtime-config.test.ts` proves import is free, first use throws,
  the proxy path throws too, and a populated `DATABASE_URL` changes nothing.

Verified: `npm run build` exits 0 with no `APP_RUNTIME_DATABASE_URL` set.

## F-07 — line endings

`.gitattributes` pins `* text=auto eol=lf`, keeps CRLF for `*.cmd`, `*.bat`
and `*.ps1`, and marks binary assets as binary. Without it a Windows checkout
with `core.autocrlf=true` produces files every formatter disagrees about, and
`format:check` fails on files nobody edited.

## F-08 — unused dependency

`resend` had no import anywhere in `app/`, `lib/` or `components/` (the grep
hits were UI copy reading "Resend invitation"). Removed; lockfile regenerated.

## F-09 — advisories, classified

`npm audit --omit=dev --json` reports **exactly one production-runtime
advisory**:

| Package | Severity | Direct | Fix available        |
| ------- | -------- | ------ | -------------------- |
| `next`  | high     | yes    | `16.4.2` (non-major) |

Everything else in the full audit (5 moderate, 11 high) is **dev-only**: `esbuild`
via `drizzle-kit`'s `@esbuild-kit` chain, `fast-glob` via ESLint plugins, and
`brace-expansion` / `braces` through the toolchain. None of it ships.

**Deferred deliberately.** `npm audit fix --force` was not run. The single
production item is a Next **minor** upgrade (16.3.6 → 16.4.2), which is not a
patch bump: it can change App Router behaviour, and performing it inside a
hardening+API program would invalidate the regression evidence this branch
depends on. It is recorded here as the top outstanding security item and should
be its own change, with the full suite as its acceptance test.

## Quality gate

Run on this branch before committing:

```text
npm run format:check
npm run lint
npm run db:check
npm run typecheck
npm test                    (hermetic, 295 passing)
npm run test:integration    (fails fast without configuration — by design)
npm run build               (with no APP_RUNTIME_DATABASE_URL)
git diff --check
```

No production DML, no direct table grant, no RLS change, no secret in the diff.
