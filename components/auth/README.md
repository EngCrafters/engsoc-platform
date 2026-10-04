# Auth UI

Shared frame for the signed-out screens: `/admin/login`, `/admin/recovery`,
`/auth/reset`. `AuthShell` centers one card over the decorative `Starfield` galaxy: a slowly
rotating Milky Way band with a glowing core, star dust, twinkling and glinting
stars, and an occasional shooting star. The screen is always dark (a scoped
`dark` class), whatever the site theme, so the galaxy reads as space. The
canvas is `aria-hidden`, shows a single still frame under
`prefers-reduced-motion`, pauses when the tab is hidden, and never carries
content. The card fades in once.

`AuthMessage` is the shared error/success banner; `authLinkClass` styles the
plain-text links ("Forgot your password?", "Back to sign in"). Forms
(`login-form.tsx`, `recovery-form.tsx`, `reset-form.tsx`) use the shared
`FormField`/`FormActions` primitives from `components/ui/form-field.tsx`.
