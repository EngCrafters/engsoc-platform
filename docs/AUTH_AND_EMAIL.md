# Authentication, Auth email and user administration

Operational guide for sign-in, password recovery, Auth email delivery and the
Technical Team's user management at `/admin/access`. It contains no secrets and
must never be edited to include one: not an SMTP password, a service key, a
recovery link, a token, or a user's password.

## 1. Architecture

- **Identity** is a Supabase Auth user (`auth.users`): an email address and a
  credential. The app never derives a role from an email address.
- **Authorization** is a separate grant in `public.administrative_access`:
  `TECHNICAL`, `BOARD_ADMIN`, or `COMMITTEE_MANAGER` (exactly one committee).
  `lib/auth/manager.ts` reads it on every request.
- **Creating an Auth user does not grant dashboard access.** Revoking access
  does not delete the Auth user. Granting always goes through the audited
  routines (`private.change_administrative_access`,
  `private.change_technical_access`). The last active Technical Team user can
  never be removed (`LAST_TECHNICAL_ADMIN`).
- **Server only.** Auth Admin operations (`lib/auth/admin.ts`) use
  `SUPABASE_SERVICE_ROLE_KEY`, which exists only as a sensitive Vercel
  Production variable and in no browser bundle. Every Technical action first
  authenticates the caller and requires an active Technical grant. The
  directory and audit reads use the restricted `app_runtime` role through
  `private.list_auth_directory` and `private.list_user_audit`, so the service
  key is needed only to create users, send invitations and set passwords.
- **Passwords are write-only.** No screen, route, log, audit row or response
  returns a password, hash, token or recovery link.

## 2. Password recovery flow

```
/admin/recovery
  -> Supabase Auth recovery request (redirectTo = <origin>/auth/callback)
  -> recovery email
  -> https://engsoc-platform.vercel.app/auth/callback
  -> verify the link, write the session cookie
  -> /auth/reset            (choose + confirm a new password)
  -> password updated, recovery session ended
  -> /admin/login?reset=success
```

- `/auth/callback` accepts a PKCE `code` (the app's own request, which needs
  the same browser) or `token_hash` + `type` (the recommended template, which
  works on any device). Types accepted: `recovery`, `invite`, `signup`,
  `email_change`, `magiclink`, `email`.
- **Expired or invalid link:** `/admin/recovery?link=expired` or `?link=invalid`
  with a clear message and a way to request a new one. `/auth/reset` itself
  never shows a form without a live session; it offers "Request a new link".
- **Fragment safety net.** An email that still delivers `#access_token=...`
  (for example one sent from the Supabase Dashboard, which has no `redirectTo`
  and falls back to the Site URL root) is handled by `AuthHashRelay` in the
  root layout. It removes the fragment from the address bar and history first,
  turns the tokens into the normal cookie session, and sends the user to
  `/auth/reset`. A fragment error such as `otp_expired` goes to the recovery
  page. Unrelated fragments are ignored.
- **Do not test recovery by sending an email from the Supabase Dashboard.**
  Use `/admin/recovery`, in the browser where the link will be opened, or the
  Technical "Send reset email" action.
- If a recovery link is ever exposed, sign that user out globally through
  Supabase Auth, discard the link, and request a fresh one. An issued access
  token can stay valid until it expires.

### Verified production configuration (October 5, 2026)

A probe with a throwaway account, which sent no email and was deleted
afterwards, showed:

| Redirect requested                                 | Result                                    |
| -------------------------------------------------- | ----------------------------------------- |
| `https://engsoc-platform.vercel.app/auth/callback` | honoured                                  |
| same with `?next=/auth/reset`                      | honoured                                  |
| `https://engsoc-platform.vercel.app/auth/reset`    | honoured                                  |
| `https://engsoc-platform.vercel.app/`              | honoured                                  |
| `http://localhost:3000/auth/callback`              | falls back to Site URL (not allow-listed) |
| `https://evil.example/auth/callback`               | falls back to Site URL                    |

So the Site URL is the production origin, the production callback is on the
allow-list, and no Auth email can redirect to localhost or a foreign host.
`AUTH_REDIRECT_ORIGIN` (Vercel Production and Preview) is
`https://engsoc-platform.vercel.app`; the app builds `<origin>/auth/callback`
from it and refuses a non-https or localhost origin in production. To develop
recovery locally, add `http://localhost:3000/auth/callback` to the Redirect URLs
and set `AUTH_REDIRECT_ORIGIN=http://localhost:3000` in `.env.local` only.

Supabase Dashboard, Authentication, URL Configuration:

- Site URL: `https://engsoc-platform.vercel.app`
- Redirect URLs: `https://engsoc-platform.vercel.app/auth/callback` and
  `https://engsoc-platform.vercel.app/auth/reset` (plus the localhost callback
  for development only).

## 3. Email templates (Supabase Dashboard, Authentication, Emails)

The default templates use `{{ .ConfirmationURL }}`. With the app's PKCE request
that link only completes in the browser that asked for it. Use token-hash links
instead, which complete on any device and do not depend on `{{ .RedirectTo }}`:

Recovery (subject: `Reset your Engineering Society password`):

```html
<h2>Reset your password</h2>
<p>Choose a new password for your Engineering Society account:</p>
<p>
  <a
    href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery"
    >Reset password</a
  >
</p>
<p>
  If you did not ask for this, ignore this email. Your password will not change.
</p>
```

Invite (`type=invite`), Confirm signup (`type=signup`) and Change email
address (`type=email_change`) follow the same shape:
`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<type>`.

Rules: never hardcode a host (the `{{ .SiteURL }}` must stay the production
origin), never point a template at the site root, and never put a password in a
template. The recovery link is single-use and expires; some mail scanners open
links before the person does, which makes the link look expired. If that
happens, request a new one.

## 4. Auth email delivery: avoid the built-in mailer

Supabase's built-in mailer is rate limited (about two emails per hour) and is
not intended for production. Auth email must go through custom SMTP.

**Current provider: Resend.** The owner reports that production Auth email now
works through Resend. The former Mailtrap sandbox was a pilot and is not the
current delivery path. Supabase Auth sends recovery and invitation messages
through its custom SMTP configuration; the `RESEND_API_KEY` Vercel variable is
separate and is not used by the current UC-02 application flows.

Production verification (record pass/fail and timestamps only, never credentials,
message contents or links):

1. In Supabase Authentication > Emails > SMTP Settings, verify custom SMTP is
   enabled, the host is `smtp.resend.com`, the sender is on the verified domain,
   and the configured rate limit is appropriate. Do not reveal the SMTP key.
2. In Resend Domains, verify the sending domain and its SPF/DKIM records. Check
   the domain's DMARC policy in DNS. Review Resend delivery, bounce and complaint
   events for a real inbox test.
3. Request recovery from `/admin/recovery` for a controlled account, open the
   delivered link, complete `/auth/reset`, and verify the old link cannot be
   reused. Check that no link points to localhost or a foreign host.
4. Send an invitation from `/admin/access` to a controlled account and verify
   delivery and password setup. Check signup confirmation and email-change
   templates only if those flows are enabled.
5. Confirm the Resend delivery event and the corresponding Supabase Auth log.
   An accepted recovery request alone does not prove inbox delivery.

## 5. Technical user management (`/admin/access`)

Only an active Technical Team user can open it. Board Administration and
Committee Managers are denied by the route and by every server action.

- **Directory.** One row per Auth account: email, role, committee, Auth state
  (Confirmed / Invited / Unconfirmed) and application access
  (Active / Revoked / No access), with search. A row's menu offers only what
  makes sense for its state. The details sheet shows identity, access, security
  actions and its history.
- **Add user.** Email + role (+ exactly one committee for a manager) + how they
  get in:
  - _Send invitation email_ (preferred): the person sets their own password.
  - _Create without email_: a confirmed account with no password and no email;
    the person uses "Forgot your password?" later.
  - _Set temporary password_ (pilot fallback when email cannot be relied on).
    The account is created through the Auth Admin API, then access is granted by
    the audited routine. If the grant fails, the message says the account exists
    without access. A duplicate email is reported as `EMAIL_EXISTS`; use "Assign
    role" on the existing user.
- **Access.** Assign, reassign (atomic: the old committee ends as the new one
  starts) and revoke Committee Manager; grant and revoke Board Administration
  and Technical Team. An ordinary manager can never hold two committees.
- **Passwords.** "Send reset email" mails the account's own address.
  "Set temporary password" calls `auth.admin.updateUserById`; the value is
  validated (at least 12 characters, confirmed), applied once and discarded. It
  is not shown again, returned, logged, put in a URL or audited. It is
  unavailable for your own account (use the normal reset). Prefer a reset email
  whenever delivery works, and share a temporary password only privately and
  ask the person to change it.
- **No** "show password", "retrieve password", password history or token view
  exists, by design.
- **Deleting Auth users** is intentionally not offered: it could orphan audit
  history, events and registrations. Revoke access instead.

### Technical ownership transfer

Technical access is not tied to a person. To hand over ownership: grant
Technical Team to the new owner (Add user or "Assign role"), have them sign in
and confirm, then revoke the previous owner's Technical access. The database
refuses to revoke the last active Technical user:
"At least one active Technical Team administrator must remain. Grant Technical
access to another user before removing this account."

### Audit

Access changes and Auth administration are written to `private.uc02_audit`
with actor, target and time. Auth administration labels are
`user.created`, `user.invited`, `user.invitation_resent`,
`user.password_reset_sent` and `user.password_admin_reset`, with at most a short
fixed word as detail (the database rejects anything else). Password content is
never recorded.

## 6. Error messages

| Code                     | Message                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `FORBIDDEN`              | This action is available only to the Technical Team.                                                     |
| `USER_NOT_FOUND`         | The selected account no longer exists.                                                                   |
| `EMAIL_EXISTS`           | An account already exists with this email address.                                                       |
| `SECOND_MANAGER_SCOPE`   | This user already manages another committee. Reassign their committee instead.                           |
| `LAST_TECHNICAL_ADMIN`   | At least one active Technical Team administrator must remain. Grant Technical access to another user ... |
| `PASSWORD_UPDATE_FAILED` | The password could not be updated. Try again.                                                            |
| `EMAIL_RATE_LIMIT`       | Email delivery is temporarily limited. Use the Technical password-reset option or try again later.       |
| `SMTP_UNAVAILABLE`       | Authentication email delivery is temporarily unavailable.                                                |
| `RECOVERY_EXPIRED`       | This password-reset link has expired. Request a new one.                                                 |

No message exposes SQL, a stack trace, a provider error or a token.

## 7. Troubleshooting email delivery

- **"Email delivery is temporarily limited"** (HTTP 429, `over_email_send_rate_limit`):
  the project hit its hourly Auth email quota. Wait for it to clear, avoid
  repeated requests, and finish custom SMTP (section 4). In the pilot a
  Technical user can set a temporary password instead.
- **"Authentication email delivery is temporarily unavailable"**: the SMTP
  host/port/credentials in Supabase are wrong or the provider is down. Check
  Authentication, Logs for the sending error and re-enter the credentials.
- **Message not delivered**: inspect the Supabase Auth sending log and Resend
  delivery/bounce log; verify custom SMTP, sender domain, SPF and DKIM.
- **Link opens the home page with a long URL**: the email was sent from the
  Dashboard or the default template. The relay recovers it; fix the template
  (section 3) and request the next email from `/admin/recovery`.
- **"Link has expired" immediately**: a mail scanner consumed it, or it is older
  than the Auth OTP expiry. Request a new link.
- **Opened on a different device and it failed**: the default template depends
  on the requesting browser. Use the token-hash template.
- **Recovery link exposed**: globally sign the user out and request a fresh one.

## 8. Operating procedures

- **Create a user:** `/admin/access`, Add user. Prefer invitation. In the pilot
  use "Create without email" and let the person reset their own password once
  email works, or "Set temporary password" and share it privately.
- **Assign or change a role:** menu, Assign role / Reassign committee / Revoke.
- **Revoke access:** menu, Revoke access. The sign-in account remains.
- **Admin password reset:** menu, Set temporary password (Technical only), then
  ask the person to change it on their account page.
- **Reconcile production identities:** compare the directory with the agreed
  assignments; never create a duplicate account.
