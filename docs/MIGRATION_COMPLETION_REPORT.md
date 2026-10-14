# Migration Completion Report — public site into engsoc-platform

## 1. Canonical starting state

|                                |                                                  |
| ------------------------------ | ------------------------------------------------ |
| Starting `main` SHA            | `a0f8ffbfd40ac8208cad9b2445c3e31b0239ec82`       |
| Starting CI                    | run `37767106448` — success                      |
| Starting production deployment | `a0f8ffb` → `https://engsoc-platform.vercel.app` |
| Working tree at start          | clean                                            |

## 2. Final state

|                            |                                                                         |
| -------------------------- | ----------------------------------------------------------------------- |
| Integration branch         | `migration/public-site`                                                 |
| Merge commit               | `989d94c121e31fb881c4e662b1a39305a32c4034`                              |
| Production                 | `https://engsoc-platform.vercel.app` — serving the migrated public site |
| Migration pull request     | #5                                                                      |
| Working tree at completion | clean                                                                   |

Commits, in order:

```
4f2d37e chore(repo): normalise line endings and record the platform audit
c1ab309 fix(security): make the default suite hermetic and guard script targets
e8c9c45 feat(marketing): migrate the public site onto canonical data
7a133d3 fix(marketing): keep the public site usable when data is unavailable
2aa305c docs(migration): record the migration and reconcile the handoff state
989d94c feat(marketing): migrate the public site onto canonical data (#5)
```

## 3. Upstream source SHAs

| Field                                 | Value                                      |
| ------------------------------------- | ------------------------------------------ |
| `INITIAL_TEAMMATE_SOURCE_SHA`         | `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0` |
| `LATEST_REVIEWED_TEAMMATE_SOURCE_SHA` | `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0` |
| `LATEST_MIGRATED_TEAMMATE_SOURCE_SHA` | `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0` |
| `FINAL_TEAMMATE_SOURCE_SHA`           | `17bdcc4244f608a5b3ec8361db470ec1ae32a8c0` |

The final delta check found **zero** new upstream commits: `origin/main` was still
the initial SHA, with an empty diff and a clean working tree. No delta porting was
required, and the reviewed SHA and the migrated SHA are the same commit.

## 4. Features migrated

| Feature                                                                          | Where it now lives                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Public navigation shell (glass bar, mobile panel, focus management, scroll lock) | `components/marketing/site-header.tsx`                                             |
| Footer with society identity and social accounts                                 | `components/marketing/site-footer.tsx`                                             |
| Hero with the society's emblem                                                   | `components/marketing/hero.tsx`, `hero-art.tsx`                                    |
| Figures strip with count-up and the demo tag                                     | `components/marketing/stats-strip.tsx`                                             |
| Society overview over its own photograph                                         | `components/marketing/overview-section.tsx`                                        |
| Event catalogue — **live database rows**, not samples                            | `app/(marketing)/events/page.tsx`                                                  |
| Event detail and registration                                                    | `app/(marketing)/events/[id]/page.tsx`, `registration-form.tsx`                    |
| Six programmes with slideshows (autoplay, swipe, dots, keyboard, pause-on-focus) | `components/marketing/activities-section.tsx`, `activity-slideshow.tsx`            |
| Project archive preview with a discipline filter                                 | `components/marketing/projects-section.tsx`, `projects-browser.tsx`                |
| Seven-discipline index with the "leaf" tile                                      | `components/marketing/disciplines-section.tsx`                                     |
| Leadership with vacant placeholders                                              | `components/marketing/leadership-section.tsx`                                      |
| Society structure: committees and teams                                          | `components/marketing/structure-section.tsx`                                       |
| Join invitation                                                                  | `components/marketing/join-section.tsx`                                            |
| `/about`                                                                         | `app/(marketing)/about/page.tsx`                                                   |
| `/activities` archive with an honest empty state                                 | `app/(marketing)/activities/page.tsx`, `archive-empty.tsx`                         |
| English/Arabic with typed dictionaries and correct RTL                           | `lib/i18n/**`, `components/marketing/i18n-provider.tsx`                            |
| Design tokens, palette, drawing styles                                           | `app/(marketing)/marketing.css`                                                    |
| The eight technical drawings and the icon set                                    | `components/marketing/drawings.tsx`, `icons.tsx`, `StatIcon.tsx`, `SocialIcon.tsx` |
| Presentation content model with its honesty flags                                | `content/**`                                                                       |
| The society's photographs, emblem, wordmark and hero stills                      | `public/brand`, `public/hero`, `public/images`                                     |

## 5. Features adapted

- **`content/site.ts`** — `signInUrl` now points at `/admin/login`, the platform's
  real sign-in, instead of being `null`.
- **Hero** — the three prepared stills and the breakpoint `<picture>` strategy are
  carried over exactly; the live WebGL sculpture is deferred.
- **Dictionaries** — extended with the canonical event labels and the complete
  registration result vocabulary, so every `RegisterForEventError` has a
  translation in both languages.
- **`.gitattributes`** added, which is why 274 files show as touched in the merge
  while `git diff` between the trees is empty for all of them: the working tree
  was normalised to LF, which is what the repository already stored.

## 6. Features rewritten

Every component was re-expressed in the canonical Tailwind and shadcn system
rather than carried over as CSS Modules, so the application does not end up with
two styling systems. The upstream palette, type scale, fonts, "leaf" geometry,
section rhythm and motion vocabulary are preserved as `--m-*` tokens scoped to
`.marketing-surface`.

GSAP was replaced by the canonical `motion` library: one `Reveal` component
replaces nine scroll recipes, and it disarms itself below the fold so content is
never hidden without JavaScript.

## 7. Features discarded

| Discarded                                                                            | Reason                                                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `content/events.ts` (sample listings)                                                | Events are canonical database rows. A static list beside a real table is two sources for one fact.                                  |
| `PreviewAction` and its "registration isn't open" dialog                             | It existed because upstream had no backend. In an application that genuinely registers people, it reads as a broken feature.        |
| GSAP, `@react-three/fiber`, `@react-three/drei`                                      | ADR 0011 removed GSAP from this repository on purpose; the 3D stack would add a renderer and scene graph to the public entry route. |
| 19 CSS Modules                                                                       | A second styling system.                                                                                                            |
| The `CustomEvent` project-filter bridge                                              | Cross-component browser events do not survive a real router; the filter is local state on its one consumer.                         |
| The layered canvas light field                                                       | Continuous canvas work on a content page.                                                                                           |
| ~10.5 MB of unresized originals, two draft zips, `PRD.pdf`, ~90 vendored skill files | Source material and upstream tooling, not application assets.                                                                       |
| `app/icon.png`                                                                       | The canonical repository already has a favicon and brand mark.                                                                      |
| `scripts/m7-staging-browser-smoke.ts`                                                | Audit finding F-01: write-capable, and its target resolved through the production Supabase link.                                    |

## 8. Features deferred

| Deferred                      | Re-entry path                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The live WebGL hero sculpture | Self-contained: lazy-load a scene component behind the same capability gate the hero already has, and add an ADR for the dependencies. The stills remain the first paint either way. |
| The archive browser UI        | Unreachable upstream too, because there are no editions. It arrives with the archive use case, over database rows.                                                                   |

## 9. Architecture changes

- **One deployable.** The public experience lives in the existing
  `app/(marketing)/` route group. No second frontend, no API boundary, no
  submodule, no subtree, no runtime dependency on the upstream repository.
- **One new adapter seam**: `lib/marketing/adapters.ts`, typed, deterministic,
  with no authorization decision and no persistence. It cannot widen the
  canonical `PublicEvent` DTO.
- **Contained theming**: the public palette is scoped to `.marketing-surface` and
  the public `dir` is applied to that subtree rather than to `<html>`, so the
  admin area keeps its own tokens, fonts and direction.
- **A new route**: `/events`, which did not exist before this migration.
- **No canonical security, data or authorization behaviour changed.** No migration
  was authored. `app_runtime` still has no direct table grant; RLS is still
  enabled and forced; `administrative_access` is still the only authorization
  source; registration still goes through `private.register_for_event`.

## 10. Dependencies

| Change      | Package            | Reason                                                                                                            |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Removed** | `resend` `^6.28.0` | Never imported. Auth email goes through Supabase SMTP; the application does not use this package.                 |
| **Added**   | none               | The migration deliberately introduced no new runtime dependency. `three` was already present for the auth mascot. |

## 11. Security findings fixed

| Finding                                                               | Status                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-01** write-capable script targeting production through `--linked` | **Fixed.** The script is removed. `scripts/lib/supabase-target.mjs` derives the project ref from the connection identity and fails closed unless a non-production ref is named explicitly. Both remaining role-check scripts use it, and `tests/script-safety.test.ts` proves each refusal path: no ref, production ref, mismatched ref, undeterminable ref, and `--linked`. |
| **F-02** the test gate threw at import without staging credentials    | **Fixed.** The live staging proof moved to `tests/integration/` behind its own config and skips when unconfigured, so `npm test` is hermetic. CI runs it as an explicit step, and a preceding step fails the build if its variables are unset, so coverage cannot silently disappear.                                                                                        |
| **F-03** a decade-long staging anon JWT committed in workflow source  | **Fixed.** It now comes from the `STAGING_SUPABASE_ANON_KEY` repository variable, alongside `STAGING_SUPABASE_URL`.                                                                                                                                                                                                                                                          |
| **F-06** the production build required a runtime database credential  | **Fixed.** The client connects on first use, and `instrumentation.ts` reports a missing credential at startup without taking the server down.                                                                                                                                                                                                                                |
| **F-07** the format gate failed on every file on Windows              | **Fixed.** `.gitattributes` with `* text=auto eol=lf`; the working tree was normalised; `npm run format:check` now passes on Windows.                                                                                                                                                                                                                                        |
| **F-08** unused `resend` dependency                                   | **Fixed.** Removed from `package.json` and the lockfile.                                                                                                                                                                                                                                                                                                                     |
| **F-09** development dependency advisories                            | **Reviewed, deferred.** No new advisory was introduced. No forced upgrade was run.                                                                                                                                                                                                                                                                                           |

Two further defects were found and fixed **by verifying the preview rather than
trusting its "Ready" status**:

- `instrumentation.ts` originally threw on a missing credential. Next.js treats a
  failed instrumentation hook as a failed server, so **every** route — including
  sign-in and password recovery, which never touch the database — returned 500.
  It now reports instead of throwing.
- A failed events read took the whole landing page and the whole catalogue down.
  Eight of the landing page's nine sections are static content, so a database
  problem was hiding the society's overview, programmes, projects and structure.
  Both surfaces now degrade to a distinct, honest "temporarily unavailable" state,
  so a failed read is never presented as an empty catalogue.

## 12. Accepted residual risks

| Risk                                                                                 | Why accepted                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public routes are dynamically rendered, because the locale is resolved from a cookie | Deliberate and contained. It is what lets a returning Arabic visitor receive Arabic, right-to-left HTML with no flash. Each page is one routine call, and the catalogue is cursor-paginated. |
| The live hero sculpture is not migrated                                              | Recorded as DEFER, not dropped. The stills are the first paint upstream too, so the visible result is the same or better on slow devices.                                                    |
| Presentation content has no database backing yet                                     | It is not domain data. Every unverified value keeps its machine-readable flag and renders a visible label.                                                                                   |
| A missing runtime database credential is reported, not fatal                         | Failing the whole server to protect data routes that do not exist yet is the worse trade. Data routes still fail closed on first query.                                                      |

## 13. Test totals

|                            | Before                                                          | After                                                                      |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Unit + database (hermetic) | 247 passed, 1 skipped, **1 file failed to load**                | **261 passed, 0 skipped, 35 files**                                        |
| Live staging integration   | ran inside `npm test`, required credentials, threw without them | explicit `npm run test:integration`; CI gates it                           |
| Browser (Playwright)       | 43 passes / 1 skip                                              | 48 passed / 1 skip, plus 5 new specs covering the migrated public surfaces |

The one pre-existing failure was the defect being fixed. New tests added:
`tests/script-safety.test.ts` (guard refusal paths) and
`tests/e2e/marketing-site.spec.ts` (landing page, navigation, mobile menu,
language switch and the registration panel).

No existing test was deleted. `tests/e2e/public-events.spec.ts` was updated to the
catalogue's new route and its region locator was made precise, because an
unscoped role query matches the toaster's live regions once they hydrate.

## 14. CI

| Run           | Scope                                | Result                                                                                                                                                                                                   |
| ------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `38524339008` | first PR push                        | **fail** — 5 browser specs; all were genuine defects, all fixed                                                                                                                                          |
| `38526563193` | final PR head `2aa305c`              | **pass** — commitlint, lint/type-check/test/build (3m29s), Vercel                                                                                                                                        |
| `38527027173` | `main` at the merge commit `989d94c` | **fail — commitlint only**: the merge commit's own body contained a line longer than 100 characters. Every code and browser check passed, and all five branch commits passed commitlint on the same run. |

The merge-commit message failure is a process defect in how the merge was
requested, not a defect in the merged work. It is recorded here rather than
hidden: the offending message is on a pushed commit, and rewriting it would mean
force-pushing `main`, which this repository does not do.

## 15. Preview verification

Preview: `https://engsoc-platform-git-migration-public-site-eng-crafters.vercel.app`
(behind Vercel deployment protection; read through `vercel curl`).

Verified on the preview at the final branch SHA:

| Check                                                                                                             | Result                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/`                                                                                                               | 200, 149 KB, marketing surface present                             |
| Hero, lead, figures, demo tag, overview, programmes, projects, sample chip, disciplines, leadership vacancy, join | all present                                                        |
| `/events`, `/about`, `/activities`                                                                                | 200, correct titles                                                |
| `/dev/design-system`                                                                                              | 404, and the dev content is absent from the response               |
| `/admin/login`, `/auth/reset`                                                                                     | 200, canonical titles                                              |
| Skip link, language switch, committee sign-in link, footer, "Link to come" for unverified socials                 | all present                                                        |
| Event section                                                                                                     | degrades to the honest "temporarily unavailable" state — see below |

**The preview has no `APP_RUNTIME_DATABASE_URL`.** Vercel preview deployments for
this project are not given a database credential, so preview pages cannot read
production data. Before this migration that produced a _failed preview build_;
now it produces a working preview whose data sections say so. Giving previews a
database credential is a data-exposure decision and is left to the owner (§21).

## 16. Production deployment

Deployed by the existing Vercel GitHub integration on the merge to `main`. No
competing pipeline was created.

| Check                         | Before merge                            | After merge                             |
| ----------------------------- | --------------------------------------- | --------------------------------------- |
| `/`                           | 200                                     | 200, 158 KB, migrated public site       |
| `/events`                     | **404 — route did not exist**           | **200, serving live published events**  |
| `/about`                      | 404                                     | 200                                     |
| `/activities`                 | 404                                     | 200                                     |
| `/admin/access`               | 307 → `/admin/login?next=/admin/events` | 307 → `/admin/login?next=/admin/events` |
| `/admin/login`, `/auth/reset` | 200                                     | 200                                     |
| `/dev/design-system`          | 404                                     | 404                                     |

## 17. Production smoke verification

Run against the live production URL, read-only:

- **Content**: hero, society figures with the demo tag, overview, programmes,
  projects with the sample chip, disciplines, leadership with vacancy
  placeholders, join invitation, skip link, language switch, committee sign-in
  link and footer all render. The **events section renders live events** — the
  production database is reachable, so the degraded state is not in use and
  `/events` returns a populated catalogue.
- **Security headers**: `Content-Security-Policy: frame-ancestors 'none'; base-uri
'self'; object-src 'none'`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, and
  no `x-powered-by`.
- **Admin boundary**: `/admin/access` still redirects to the sign-in page with
  the canonical `next` parameter.
- **Dev route**: still 404 in production.

Not performed, and deliberately so: no registration was submitted against
production, because that would create a real attendee record. The registration
path is covered by the hermetic database suite (which exercises
`private.register_for_event` including both concurrency races) and by the
Playwright suite against a disposable database.

## 18. Rollback and recovery

- **This migration requires no database change.** There is nothing to roll back
  at the schema level and no migration to reverse.
- **Application rollback is one action**: re-promote the previous Vercel
  production deployment (`a0f8ffb`), or revert the merge commit. Both are
  Git/Vercel-level operations, fully reversible.
- The database work in this branch is limited to DDL-free script changes and test
  movement; production data was never written to.
- Existing recovery evidence is unchanged from the hardening audit: a logical
  snapshot was restored with `pg_restore --exit-on-error` into a disposable
  PostgreSQL 17.6 instance. PITR remains disabled and there is still no automated
  backup; that is a pre-existing operational gap, not one this migration created.

## 19. Documentation

| Document                                                                                      | Purpose                                                           |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `docs/MIGRATION_SOURCE_MAP.md`                                                                | Every upstream file, its decision and destination; the SHA ledger |
| `docs/TEAMMATE_REPO_AUDIT.md`                                                                 | What the upstream repository is                                   |
| `docs/MIGRATION_ARCHITECTURE.md`                                                              | The target state and why it is one application                    |
| `docs/MIGRATION_RISK_REGISTER.md`                                                             | Risks and the control actually applied                            |
| `docs/MIGRATION_EXECUTION_PLAN.md`                                                            | The order this followed                                           |
| `docs/DEEPSEEK_PLATFORM_AUDIT.md`                                                             | The pre-migration audit this work responds to                     |
| `docs/ARCHITECTURE_MAP.md`, `docs/ARCHITECTURAL_INVARIANTS.md`, `docs/MIGRATION_READINESS.md` | Architecture and invariants                                       |
| `app/(marketing)/README.md`                                                                   | The rules the public route group follows                          |
| `README.md`, `docs/CURRENT_WORK.md`                                                           | Updated for the migrated site                                     |

Documentation drift resolved or marked: the README's project structure and public
site section; `CURRENT_WORK.md`'s claim that no landing-page migration had
started is struck through and marked superseded rather than deleted.

## 20. Remaining owner-only items

1. **The real Support manager identity, assignment and private sign-in pilot.**
   Unchanged and still the sole UC-02 release hold. No placeholder was created.
2. **The Vercel Preview environment has no `APP_RUNTIME_DATABASE_URL`.** Preview
   deployments therefore render the marketing shell with an honest unavailable
   state for event data. Supplying a credential is a data-exposure decision.
3. **The next use case has not been chosen**, which is what formally closes UC-02.
4. **PITR, automated backups and a timed recovery objective** remain absent.
5. **Unpaginated Auth directory** and **unbounded `registration_attempts`** remain
   as recorded in the audit.

## 21. Recommended future workflow

**Future development of the integrated public site should happen in
`engsoc-platform`, on feature branches, and should not require another
migration.** The upstream repository is not a dependency, not a submodule and not
a source of truth; it is not archived or modified, because it belongs to its own
owner.

Concretely:

- Change the public site in `app/(marketing)/`, `components/marketing/` and
  `content/`, following `app/(marketing)/README.md`.
- Presentation content with no database backing stays in `content/` with its
  honesty flags intact. Adding an unverified figure without a flag is the one
  thing that would undo this migration's strongest quality.
- New domain data goes through the canonical modules and the private routines,
  never around them. In particular, do not add a browser-side database read or a
  second registration writer.
- Any change to Auth, authorization, RLS, grants or the routines is a change to
  the platform's security model and needs an ADR first, not a pull request.
- Re-adding the 3D hero scene needs an ADR for its dependencies, and the stills
  must remain the first paint.
- Vercel preview deployments are useful for visual review, but they cannot read
  production data until the Preview environment is given a credential.

If a future upstream change is wanted, treat it as a small, bounded port into
`engsoc-platform` — the same classification process this migration used, applied
to a delta rather than a repository.
