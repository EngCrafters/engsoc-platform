# ADR 0013: Technical-only user administration through the Auth Admin API

## Status

Accepted; owner decision, October 5, 2026. Extends ADR 0012 (access hierarchy).
The Mailtrap pilot and pre-SMTP consequences below are historical; Resend is
the current production Auth email provider (see `docs/AUTH_AND_EMAIL.md`).

## Context

The Technical Team had to open the Supabase dashboard to create users, resend
invitations and reset passwords, and Supabase's built-in email limit (about
two messages per hour) made recovery unreliable. A recovery email sent from
the dashboard also landed at the site root with session tokens in the URL.

## Decision

- The Technical Team manages **Auth users and application access** from
  `/admin/access`. The two stay separate: an Auth user is an identity;
  `administrative_access` is authorization. Creating an account grants nothing,
  and revoking access deletes nothing.
- Account creation, invitations and temporary passwords use the **Supabase
  Auth Admin API, server-side only**, with `SUPABASE_SERVICE_ROLE_KEY` stored as
  a sensitive Vercel Production variable and read in one module
  (`lib/auth/admin.ts`). Every action authenticates the caller and requires an
  active Technical grant first. Reads use the restricted `app_runtime` role.
- Migration 0021 adds only: identity-state columns on the private Auth view
  (confirmed, created, last sign-in, invited), `list_auth_directory`,
  `list_user_audit`, and `record_auth_admin_action`, whose actions are fixed
  labels with a short, character-restricted detail so a secret cannot be stored.
- Passwords are write-only. A "set temporary password" fallback exists for the
  pilot; it never returns, logs or audits the password and is unavailable for
  the caller's own account.
- Auth users are not deleted from the application.
- Recovery lands on `/auth/callback`, supports token-hash links (any device)
  and PKCE codes, and a root-level relay removes session fragments from the URL
  and completes the sign-in.
- Auth email moves to custom SMTP. Mailtrap Email Sandbox is the pilot test
  sink only; real delivery needs a verified domain and provider (documented in
  `docs/AUTH_AND_EMAIL.md`).

## Consequences

- The service-role key now exists in production runtime configuration. Its use
  is confined to `lib/auth/admin.ts`; replace it with a dedicated secret API key
  when convenient, and rotate it if it is ever exposed.
- Until custom SMTP is configured and a real domain exists, invitation and reset
  emails are limited or sandboxed; the temporary-password fallback and
  "create without email" cover the pilot.
