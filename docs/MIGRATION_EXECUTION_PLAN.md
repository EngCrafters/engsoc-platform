# Migration Execution Plan

The ordered plan this migration followed, with the delivery gates that applied at
each step. Recorded so the next migration does not have to rediscover it.

## Phase 0 — Harden the starting point

| Step | Action                                                                                   | Gate                                                        |
| ---- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0.1  | Record both repositories' HEAD, branch, remote and working-tree state                    | `INITIAL_TEAMMATE_SOURCE_SHA` captured                      |
| 0.2  | Branch `migration/public-site` from clean `main`                                         | Branch pushed                                               |
| 0.3  | Remove the write-capable, production-adjacent M7 smoke script; add a tested target guard | Guard tests pass                                            |
| 0.4  | Split the live staging RLS proof into an explicit integration suite                      | `npm test` runs with no network and no credentials          |
| 0.5  | Move the committed staging anon key into a repository variable                           | CI asserts the variable exists                              |
| 0.6  | Defer the runtime database client so the build is hermetic                               | `npm run build` succeeds with no `APP_RUNTIME_DATABASE_URL` |
| 0.7  | Add `.gitattributes` and normalise the working tree                                      | `npm run format:check` passes on Windows                    |
| 0.8  | Remove the unused `resend` dependency                                                    | Lockfile in sync; `npm ci` clean                            |

## Phase 1 — Understand the upstream

| Step | Action                                       | Output                            |
| ---- | -------------------------------------------- | --------------------------------- |
| 1.1  | Full read of the upstream repository         | `docs/TEAMMATE_REPO_AUDIT.md`     |
| 1.2  | Compare stacks and classify every difference | `docs/MIGRATION_ARCHITECTURE.md`  |
| 1.3  | Record risks and controls                    | `docs/MIGRATION_RISK_REGISTER.md` |
| 1.4  | Classify every upstream feature              | `docs/MIGRATION_SOURCE_MAP.md`    |

## Phase 2 — Foundation

| Step | Action                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------- |
| 2.1  | Port the marketing palette and drawing styles into a scoped stylesheet                               |
| 2.2  | Map the palette into Tailwind's theme                                                                |
| 2.3  | Port the i18n data layer and extend both dictionaries with the canonical event and registration copy |
| 2.4  | Port the presentation content model, minus events                                                    |
| 2.5  | Port the assets the site actually serves                                                             |

## Phase 3 — Shell and language

Public shell (header with mobile panel and focus management, footer), the i18n
provider, the language switch, and one reveal component replacing nine GSAP
recipes.

## Phase 4 — Landing page

Hero, figures, overview, events, programmes, projects, disciplines, leadership,
invitation.

## Phase 5 — Canonical data surfaces

`/events` catalogue, `/events/[id]` detail, and the registration form against the
canonical Server Action, plus the typed adapter between them.

## Phase 6 — Society pages

`/about` and `/activities`.

## Phase 7 — Verification

| Gate                    | Command                |
| ----------------------- | ---------------------- |
| Formatting              | `npm run format:check` |
| Linting                 | `npm run lint`         |
| Migration consistency   | `npm run db:check`     |
| Types                   | `npm run typecheck`    |
| Unit and database tests | `npm test`             |
| Browser tests           | `npm run test:e2e`     |
| Production build        | `npm run build`        |
| Whitespace              | `git diff --check`     |

## Phase 8 — Delta synchronisation

Re-fetch the upstream repository immediately before merge, review only the delta
since the migrated SHA, classify each change, port the relevant ones, re-run the
full gate, and re-verify the preview. Repeat until the reviewed SHA and the
migrated SHA agree.

## Phase 9 — Preview, merge, production

Push the branch, create the pull request, wait for CI to be green, inspect the
Vercel preview in a real browser, then merge to `main` and let the existing
Vercel GitHub integration deploy production. Verify production directly rather
than trusting the deployment status.

## Phase 10 — Documentation and handoff

Audit reconciliation, `docs/CURRENT_WORK.md`, the README, and the completion
report, including the recommendation that future public-site development happens
in this repository.
