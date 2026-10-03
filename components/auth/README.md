# Auth UI

Shared frame for the signed-out screens: `/admin/login`, `/admin/recovery`,
`/auth/reset`. `AuthShell` composes `AuthAside` (desktop brand panel) and a
plain form column, so the three pages stay consistent without duplicating
layout. It is deliberately quiet: no cards, canvas effects, or entrance
animation beyond a short fade (see `docs/DESIGN_SYSTEM.md`).

`AuthMessage` is the shared error/success banner; `authLinkClass` styles the
plain-text links ("Forgot your password?", "Back to sign in"). Forms
(`login-form.tsx`, `recovery-form.tsx`, `reset-form.tsx`) use the shared
`FormField`/`FormActions` primitives from `components/ui/form-field.tsx`.
