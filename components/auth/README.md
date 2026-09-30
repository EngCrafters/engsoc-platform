# Auth UI

Shared frame for the signed-out screens: `/admin/login`, `/admin/recovery`,
`/auth/reset`. `AuthShell` composes `AuthAside` (desktop brand panel) and a
`glass`-variant `Card` (see `components/ui/card.tsx`) for the form, so the
three pages stay visually consistent without duplicating layout.

`AuthAside` is decorative only: a GSAP entrance (brand mark, eyebrow,
heading, description) and the Canvas UI `Liquid` background
(`components/canvasui/Liquid.tsx`) are scoped to that column and never wrap
the form card. Both already degrade without input: `Liquid` no-ops pointer
splats under `prefers-reduced-motion` and falls back to plain DOM if WebGL2
isn't available; the GSAP timeline is skipped entirely when
`prefers-reduced-motion: reduce` matches. See `docs/DESIGN_SYSTEM.md`
"Auth surfaces" for the usage rule before extending this to another page.

`AuthMessage` is the shared error/success banner; `authLinkClass` styles the
plain-text links ("Forgot your password?", "Back to sign in"). Forms
(`login-form.tsx`, `recovery-form.tsx`, `reset-form.tsx`) use the shared
`FormField`/`FormActions` primitives from `components/ui/form-field.tsx`.
