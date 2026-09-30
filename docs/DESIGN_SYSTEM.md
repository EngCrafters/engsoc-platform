# Design system

Source of truth for tokens, components, and motion conventions across the
platform. Written after a refine-and-complete pass over the existing
foundation — see `docs/adr/0010-project-wide-design-system.md` for why and
when this work happened, and `docs/CURRENT_WORK.md` for how it relates to
UC-02. New UI work should consume this, not re-derive conventions from
scratch or introduce new ad-hoc colors.

## Principles

- **Tokens, not literals.** Every color, radius, shadow, and motion value in
  application code comes from a named token (`app/globals.css`,
  `lib/motion/variants.ts`) or a component variant — never a raw hex/OKLCH
  value or a one-off `duration-[237ms]` in a page or feature component.
- **Status colors carry meaning, not decoration.** A status is always
  paired with an icon or text, never color alone (see `EventStatusBadge`).
- **Effects are restrained and optional.** Canvas UI/GSAP are for one or two
  memorable moments (the auth page), not the whole product. They must
  degrade gracefully and never gate core usability.
- **Refine, don't replace.** This system built on an already-disciplined
  OKLCH token set; extend it rather than introducing a second system
  alongside it.

## Color tokens

Semantic tokens defined in `app/globals.css` (`:root` / `.dark`), wired into
Tailwind via the `@theme inline` block:

- **Surfaces:** `background`, `foreground`, `surface`, `surface-raised`,
  `card`, `popover`, `muted`.
- **Brand:** `primary` (+ `-foreground`, `-soft`, `-soft-foreground`),
  `secondary`, `accent` (+ `-soft`).
- **Status (each has a `-soft`/`-soft-foreground` pair for badges/banners):**
  `success`, `warning`, `danger`/`destructive`, `full` (capacity-full),
  `quiet` (archived/inactive).
- **Structure:** `border`, `input`, `ring`.
- **Shell** (dark navy nav rail and other strong structural surfaces):
  `shell`, `shell-foreground`, `shell-muted`, `shell-border`,
  `shell-accent` (+ `-foreground`). Mirrored into the `sidebar-*` tokens shadcn
  expects.
- **Glass** (new): `glass` / `glass-border` — a translucent surface + border
  pair for floating/auth panels only (`Card variant="glass"`). Never use for
  dashboard data cards.

Accent usage stays restrained: `primary` (blue) is the one product accent;
status colors only appear where they communicate state (badges, alerts,
small indicators), not as card backgrounds.

## Typography

Geist (variable) via `next/font/google` in `app/layout.tsx`, aliased to
`font-sans`/`font-heading`. One family, disciplined weights:

- 400 — body text
- 500 — labels, navigation
- 600 — section titles, buttons
- 700 — occasional strong headings only

Type scale in practice (see `app/dev/design-system` for a live reference):
display/page title (`text-3xl`+, `tracking-[-0.04em]`), section title
(`text-lg font-semibold tracking-tight`), card title (`text-base
font-medium`), body (`text-sm`), small body/caption (`text-xs
text-muted-foreground`), label (`text-xs font-medium uppercase
tracking-wide`).

## Spacing, radius, shadows

- Radius scale in `app/globals.css`: `--radius-sm` … `--radius-4xl`, derived
  from the single `--radius` base (`0.75rem`).
- Shadows: `shadow-panel`, `shadow-raised`, `shadow-popover` — increasing
  elevation, tuned separately for light/dark.

## Components

- **Card variants** (`components/ui/card.tsx`, `variant` prop): `default`
  (dashboard data cards), `subtle` (quiet surface-on-surface), `elevated`
  (raised shadow), `interactive` (hover shadow, clickable cards), `glass`
  (auth/floating only — translucent + `backdrop-blur-xl`).
- **Badge variants** (`components/ui/badge.tsx`): includes the extended
  `-soft` status set (`primary-soft`, `success`, `warning`, `danger`,
  `full`, `quiet`) used by `EventStatusBadge` and similar.
- **Forms** (`components/ui/form-field.tsx`): `FormField` (label + required
  mark + control + description/error), `FormDescription`, `FormMessage`,
  `FormActions`. Not bound to a form library — this codebase drives forms
  with `useActionState`; pass `error`/`description` from action state and
  wire `aria-describedby` on the control using the `{htmlFor}-description` /
  `{htmlFor}-error` ids.
- **Feedback states** (`components/ui/state-panel.tsx`): `StatePanel` is the
  shared icon-circle + heading + description + action shape behind
  `EmptyState` and `ErrorState` (`components/admin/`). `NoAccessState` stays
  a standalone full-page component — it has a materially different layout
  (page-level `<main>`, bullet list, `h1`) and forcing it into the same
  shape added risk without benefit.
- **Theming** (`components/theme-provider.tsx`, `components/ui/
theme-toggle.tsx`): `next-themes`, `attribute="class"`,
  `defaultTheme="system"`. `ThemeToggle` has a `variant="shell"` styling for
  the dark navy admin shell/auth aside and a default styling for light
  surfaces; it's in the admin sidebar footer, the mobile nav sheet header,
  and both auth-shell placements (desktop aside, mobile header row).

## Motion

`lib/motion/variants.ts` is the single source for easing/duration/stagger
values — import `DURATION.fast|normal|slow` (140/200/320ms) and
`EASE_OUT`/`EASE_IN_OUT` rather than inlining transition literals.
`AdminMotionConfig` wraps the admin shell in `MotionConfig
reducedMotion="user"`, so ordinary Motion animations already honor the
user's OS/browser preference.

## Canvas UI / GSAP usage rule

Both are **auth-page-only** for this pass — not routine buttons, forms, or
dashboard interactions (those stay on `motion`):

- **GSAP** (`components/auth/auth-aside.tsx`): one entrance timeline for the
  brand mark/eyebrow/heading/description. Explicitly skipped when
  `prefers-reduced-motion: reduce` matches (checked before the timeline
  runs, not just slowed down).
- **Canvas UI Liquid** (`components/canvasui/Liquid.tsx`, registry
  `@canvas-ui` in `components.json`): scoped to the desktop auth aside only,
  never the form card. It already degrades on its own — pointer-driven
  splats no-op under `prefers-reduced-motion`, and it falls back to plain
  DOM content if WebGL2/float-texture support is missing (`createLiquid`
  returns `null`). The output canvas is `aria-hidden` and
  `pointer-events: none`.

Extending either beyond the auth surface needs a new decision (see ADR
0010), not a quiet expansion.

## Accessibility

- Status is never color-only (icon + text pairing).
- Focus rings use the `ring`/`shell-accent` tokens consistently; interactive
  elements keep visible `focus-visible` outlines.
- All decorative motion/effects respect `prefers-reduced-motion`.
- `ThemeToggle` and Canvas UI output canvases are keyboard/screen-reader
  inert where appropriate (`aria-hidden`, `pointer-events: none` on the
  canvas layer; the toggle itself is a real, labeled control).

## Dev-only reference

`app/dev/design-system` renders a live showcase of the above (typography,
status colors, buttons, card variants, form fields, feedback states). It
404s via `notFound()` whenever `NODE_ENV === "production"`, so it can never
ship as a reachable production route — see the empty, untracked
`app/qa-preview/*` directories this replaced (removed as part of this pass;
they held no files and were not a live route, but were exactly the pattern
to avoid repeating).
