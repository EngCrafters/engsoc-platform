# Teammate Repository Audit — `teammate-site` (ESWebsite)

Read-only characterization of the upstream repository before migration, taken at
`17bdcc4244f608a5b3ec8361db470ec1ae32a8c0`.

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Repository** | `https://github.com/s3q/ESWebsite.git`                                                     |
| **Local path** | `C:\Users\salim\Projects\teammate-site`                                                    |
| **Stack**      | Next.js 16.3.6 (App Router), React 19.2.8, TypeScript 5.9.3                                |
| **Backend**    | **None.** No database, no authentication, no API routes, no server actions, no middleware. |
| **Tests / CI** | **None.** No test runner, no workflow, no formatter.                                       |
| **Commits**    | 4 (`17bdcc4 m` · `a1f5284 ,,` · `e5613a9 .` · `2fd3e28 first commit`)                      |

The README states the boundary itself: _"This is the public site only: no
backend, authentication or admin tools."_

## Routes

| Route         | Rendering                 | Purpose                                                                                                        |
| ------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/`           | Server, effective dynamic | Hero, figures, overview, `#events`, `#activities`, `#projects`, `#disciplines`, `#leadership`, `#join`, footer |
| `/about`      | Server                    | Overview, society facts, full structure                                                                        |
| `/activities` | Server                    | Archive of previous editions — **empty by design** (`ACTIVITY_EDITIONS = []`)                                  |
| `/dev/emblem` | Server + client leaf      | Capture surface for the hero stills. 404s in production.                                                       |

Every route renders per request, because `getI18n()` awaits `cookies()`.

## Content model

Ten static TypeScript modules under `content/`. There is no CMS and no fetch;
every page imports its data at module scope.

The distinguishing quality is an **honesty system**: unverified content carries a
machine-readable flag that renders a visible label.

| Flag                               | Meaning                                                         | Where                                                                                           |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `demo: true`                       | Demonstration figure or event; tagged on the page and footnoted | `content/stats.ts` (all four headline figures), `content/activities.ts` (all 18 gallery events) |
| `sample: true`                     | Illustrative archive entry; carries a dashed "Sample" chip      | `content/projects.ts` (5 entries)                                                               |
| `descriptionStatus: 'needs-input'` | Copy the society has not supplied                               | `content/activities.ts` (graduate-studio)                                                       |
| `url: null`                        | No verified destination; the UI downgrades instead of linking   | `content/social.ts` (all 5), `content/site.ts` (`membershipUrl`, `signInUrl`)                   |
| `holder: null`                     | Vacant position, rendered as an intentional placeholder         | `content/structure.ts` (the entire roster)                                                      |

This is carried into the canonical repository unchanged, and it is why the
migrated site can show a figures strip without asserting anything false.

## Design system

Two global stylesheets (`styles/tokens.css`, `styles/globals.css`) plus 19 CSS
Modules. **No Tailwind.** A real token architecture: colour, an 8 px space
rhythm, radii, a fluid type scale, and one motion vocabulary.

Signature values carried into the canonical palette: ivory `#f7f8f2`, cobalt
`#234bc4`, navy `#10213d`, gold `#cba326`, and the "leaf" corner
(`border-radius: 50% 50% 50% 0`) that recurs from the logo through the icons.

**No dark mode exists** — the only dark surfaces are fixed navy bands.

## Internationalisation

Cookie-resolved (`es-locale`, one year), server-rendered, with a typed
dictionary: `export type Dictionary = typeof en` and `export const ar: Dictionary`.
An untranslated string therefore fails the build. Arabic has correct
`Intl.PluralRules` handling and is never letter-spaced. Switching calls
`router.refresh()` rather than reloading, so `lang` and `dir` change together
with no flash.

Known weakness, not carried over: `lib/i18n/index.ts` imports both dictionaries
unconditionally and client components import that module, so **both** ship to the
browser.

## Events and "registration"

`content/events.ts` holds three records, all `sample: true`, all
`registration: 'preview'`. The first array element is always the featured event;
there is no sorting, no date filter and no "upcoming" notion.

**Nothing is ever submitted.** `components/ui/PreviewAction.tsx` renders a
button that opens a native `<dialog>` whose copy says so explicitly:

> "Nothing has been submitted, and no place has been reserved."

There is no `<form>`, no `onSubmit`, no `fetch`, no `action`, no `'use server'`,
no `route.ts` and no API client anywhere in the repository.

This is honest for a site with no backend. It is **not** portable into an
application that genuinely registers people, and it was not carried over.

## Hero

A live Three.js sculpture (`three` + `@react-three/fiber` +
`@react-three/drei` + `gsap` + `@gsap/react`), lazily imported behind an
`IntersectionObserver` and a `requestIdleCallback`, with a
`frameloop="demand"` canvas and dpr caps.

The engineering around it is the best part of the repository: three prepared
stills act as first paint for every breakpoint, reduced motion, Save-Data and no
WebGL; a context-loss handler and an error boundary both fall back to a still;
rendering pauses when offscreen or when the tab is hidden.

The **stills** are migrated. The live scene is deferred — see
`docs/MIGRATION_ARCHITECTURE.md`.

## Assets

| Class                                                                                                                                                                    | Size     | Decision                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------ |
| `public/brand/*`, `public/hero/*`, `public/images/*` (13 files)                                                                                                          | ~1.9 MB  | Migrated                                               |
| Unresized originals at the repo root (4 files over 1 MB; `Competitions.JPG` alone 3.6 MB)                                                                                | ~10.5 MB | Not migrated — source material, not application assets |
| Duplicate files (`Evenings.jfif` = `overview.jfif`; `ES_logo.webp` = `es-emblem.webp`; `squ_logo1.png` = `squ-wordmark.png`; `overview.jpg` = `activities/evenings.jpg`) | —        | Not migrated                                           |
| `drafts/draft-2-source.zip`, `draft-3-source.zip`, `PRD.pdf`                                                                                                             | ~3.2 MB  | Not migrated                                           |
| `.claude/skills/**` (~90 vendored files, incl. an 856 KB JSON and a 749 KB CSV), `skills-lock.json`, `.hallmark/log.json`                                                | —        | Not migrated                                           |

## Accessibility and responsiveness

Consistently good, and the parts that matter were preserved in the migration:

- One `h1` per page; sections are `aria-labelledby` regions; the skip link is the
  first focusable element and targets a `tabIndex={-1}` main.
- Leadership is a real nested `ul` with decorative connectors `aria-hidden`;
  decorative SVG everywhere sets `aria-hidden` and `focusable="false"`.
- Focus returns to the menu button on close; Escape closes; the page scroll is
  locked while the mobile panel is open.
- Carousels are `role="region" aria-roledescription="carousel"` with real dot
  buttons, arrow-key support and an `aria-live` counter.
- Reduced motion is respected in three independent layers.
- Touch targets are 44 px or larger throughout.

## Dependencies (all verified as genuinely imported)

`next` 16.3.6 · `react` 19.2.8 · `react-dom` 19.2.8 (peer only) · `three`
0.186.0 · `@react-three/fiber` 9.7.0 · `@react-three/drei` 10.7.8 · `gsap`
3.15.0 · `@gsap/react` 2.1.2.

**None of the animation or 3D packages were carried into the canonical
repository.** `three` already existed there for the auth mascot; the rest would
have been new, and ADR 0011 removed GSAP from this repository deliberately.

## What is genuinely good, and was preserved

1. The typed, server-resolved bilingual system with a build-time completeness
   guarantee.
2. The honesty system for unverified content — the reason the migrated site can
   show figures without lying.
3. Distinguishing a null figure from a zero, and a vacancy from a person.
4. Progressive enhancement that actually holds: content is visible without
   JavaScript.
5. A real token architecture with one motion vocabulary.
6. Runtime discipline in the expensive parts (idle loading, demand rendering,
   visibility pausing).
7. The distinctive "leaf" geometry and the disciplined use of the logo colours
   as small accents rather than large fills.

## What could not be copied

| Item                                                                                             | Why                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Static content imports as the data source for events                                             | Events are canonical database rows with RLS-governed visibility. Two sources of the same fact will disagree.            |
| `content/events.ts` and `PreviewAction`                                                          | A fake registration surface in an application that really registers people reads as broken, not as honest.              |
| Duplicate entity models (`SocietyEvent`, …)                                                      | They would become a parallel type system beside the schema.                                                             |
| Hard-coded demonstration statistics presented as data                                            | Kept only as explicitly flagged demonstration values.                                                                   |
| The `CustomEvent` filter bridge                                                                  | Cross-component browser events do not survive a real router; the filter became local state on its one consumer.         |
| GSAP in the root provider                                                                        | It put an animation engine in every page's bundle, including authenticated screens.                                     |
| CSS Modules alongside Tailwind                                                                   | Two styling systems in one application was explicitly out of scope.                                                     |
| Cookie-driven per-request rendering as a blanket strategy                                        | Inherited deliberately for the public site only; the admin area must not become dynamic because a visitor chose Arabic. |
| Both dictionaries shipped to the client                                                          | A known weakness upstream; not reproduced.                                                                              |
| Repository hygiene: ~10.5 MB of unreferenced originals, two draft zips, ~90 vendored skill files | Not application assets.                                                                                                 |
| `/dev/emblem`                                                                                    | Belongs with the deferred 3D scene.                                                                                     |
