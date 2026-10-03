# Auth UI

Shared frame for the signed-out screens: `/admin/login`, `/admin/recovery`,
`/auth/reset`. `AuthShell` centers one card over the decorative `Starfield` canvas (twinkling
stars with a few glints; theme-aware, a single static frame under
`prefers-reduced-motion`, paused when the tab is hidden). The canvas is
`aria-hidden` and never carries content; the card fades in once.

`AuthMessage` is the shared error/success banner; `authLinkClass` styles the
plain-text links ("Forgot your password?", "Back to sign in"). Forms
(`login-form.tsx`, `recovery-form.tsx`, `reset-form.tsx`) use the shared
`FormField`/`FormActions` primitives from `components/ui/form-field.tsx`.
