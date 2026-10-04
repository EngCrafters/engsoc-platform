# Auth UI

Shared frame for the signed-out screens: `/admin/login`, `/admin/recovery`,
`/auth/reset`. `AuthShell` centers one card over the decorative `Starfield` galaxy: a slowly
rotating Milky Way band with a glowing core, star dust, twinkling and glinting
stars, and an occasional shooting star. The screen is always dark (a scoped
`dark` class), whatever the site theme, so the galaxy reads as space. The
canvas is `aria-hidden`, shows a single still frame under
`prefers-reduced-motion`, pauses when the tab is hidden, and never carries
content. The card fades in once.

`LoginMascot` is "Volt", a small engineer robot in a hard hat (three.js, loaded
lazily) who sits on the card's top edge, swings his legs while waiting, waves
once, follows the pointer with his eyes and covers them while a password field
has focus. Decorative only: `aria-hidden`, no pointer events, a still frame under
`prefers-reduced-motion`, and silently absent without WebGL.

`AuthMessage` is the shared error/success banner; `authLinkClass` styles the
plain-text links ("Forgot your password?", "Back to sign in"). Forms
(`login-form.tsx`, `recovery-form.tsx`, `reset-form.tsx`) use the shared
`FormField`/`FormActions` primitives from `components/ui/form-field.tsx`.
