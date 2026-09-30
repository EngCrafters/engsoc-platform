# ADR 0010: Project-wide design system, tracked separately from UC-02 closure

## Status

Accepted; owner decision, October 1, 2026.

## Context

`docs/CURRENT_WORK.md` records that UC-02 M8 shipped and that the repo holds
in "maintain UC-02, do not start another milestone" until the owner explicitly
chooses the next use case (UC-01 through UC-07). A project-wide design-system
pass — durable tokens, typography, theming, a component foundation, and
restrained Canvas UI/GSAP effects on the auth surface — was requested. That
work is not itself a numbered use case, and it is not "another milestone" in
the UC sense, but CLAUDE.md is explicit that a mismatch with the currently
active line gets flagged and written down, not assumed.

The starting brief assumed the current visual system was ad hoc/AI-generated.
It is not: `app/globals.css` already carries a disciplined OKLCH semantic
token system (surface/card/primary/secondary/accent/status-soft pairs, a navy
`shell` surface set, shadow/radius scales), Geist is already wired via
`next/font`, shadcn is already `style: radix-nova` / `baseColor: neutral`,
status badges already pair icon+color, and `lib/motion/variants.ts` already
defines shared motion tokens. This work is a refine-and-complete pass over an
existing foundation, not a replacement of it.

## Decision

Proceed with the design-system initiative now, as its own tracked line of
work, independent of and in parallel with the still-open UC-02 closure
decision. It does not change, weaken, or substitute for that decision — the
owner still needs to explicitly choose the next use case before UC-02 closes
and before UC-01/UC-03+ work begins.

Scope is presentation only: tokens, theming (light/dark via `next-themes`,
previously installed but unwired), shared component primitives (forms,
state panels, card variants), and motion. No RLS, server action, schema, or
auth-flow behavior changes as part of this initiative.

New dependencies approved for this initiative:

- **GSAP** — used only for the auth-page entrance/background sequence, not
  for routine button/form interactions (those stay on `motion`).
- **Canvas UI** (shadcn-compatible registry, WebGL liquid/glass effect) —
  used only as a decorative, `aria-hidden`, `pointer-events-none` background
  layer on auth surfaces. Must degrade to a static gradient when
  `prefers-reduced-motion` is set, on mobile, or when WebGL is unavailable.
  Core auth usability (reading, typing, submitting) must never depend on it.

Work proceeds in phases (see the design-system plan); each phase stops short
of the next until reviewed, and the full migration is not declared complete
until a visual review has happened, per the same "every phase gate is real"
principle CLAUDE.md already applies to UC work.

## Consequences

- `docs/CURRENT_WORK.md` gets a short note pointing here so a future session
  reading "do not start another milestone" isn't confused by design-system
  commits landing on `main` in the same window.
- `docs/DESIGN_SYSTEM.md` becomes the source of truth for tokens, type scale,
  component variants, motion, and Canvas UI/GSAP usage rules going forward;
  new UI work should consume it rather than re-deriving conventions from
  scratch.
- Introducing WebGL/Canvas UI anywhere outside the auth surface, or GSAP for
  routine interactions, needs a new decision, not a quiet expansion of this
  one.
