# ADR 0011: Monochrome dashboard UI based on shadcn dashboard-01 and sidebar-13

## Status

Accepted; owner decision, October 3, 2026. Supersedes the visual decisions in
ADR 0010 (navy shell, glass auth card, status colors, Canvas UI/GSAP on auth).
ADR 0010's scope decision (design work tracked separately from UC-02 closure)
still stands.

## Context

After the first design-system pass, the admin workspace worked but read as
unrelated card blocks: many nested cards, a dark navy rail, colored status
badges, an unfinished-looking settings dialog, and effect-heavy auth screens.
The owner installed shadcn `dashboard-01` and `sidebar-13` as references.

## Decision

- Adopt dashboard-01 for the admin shell (inset sidebar, header with
  breadcrumb, metric cards, table lists) and sidebar-13 for the Settings
  dialog.
- Make the system strictly monochrome; neutralise the blue-tinted core tokens
  and keep `destructive` as the only hue.
- Replace cards with sections, rows, tables and tabs; use borders instead of
  shadows.
- Simplify the signed-out screens to a quiet brand panel plus a plain form;
  remove Canvas UI `Liquid`, GSAP, `AmbientGlow` and the glass card variant.
- Keep `Density` and `Motion` as device-local preferences (localStorage); no
  schema, server, or account data is involved.

## Consequences

- No business logic, routes, authorization, or database objects changed.
- Event status badges and counts are told apart by icon, fill, and border.
- The `gsap` dependency is removed. Reintroducing decorative effects needs a
  new decision.
