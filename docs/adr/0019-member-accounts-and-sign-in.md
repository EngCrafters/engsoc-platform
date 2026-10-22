# 0019 — Member accounts: password at registration, sign-in and recovery

Status: accepted for implementation (owner direction, 2026-10-20). Changes how ADR 0017's
activation finds the applicant's Auth identity; everything else in ADR 0017 and ADR 0018 stands.
Related: ADR 0013 (Auth identity vs. access), ADR 0015 (trusted server actor), ADR 0016 (public
API), ADR 0017, `docs/AUTH_AND_EMAIL.md`, `docs/UC-01_Membership_Applications.md`

## Context

Applicants received a password-setting invitation only after approval, and could follow their
application only through a token kept in one browser. The owner asked for:

- a password chosen at registration;
- a member sign-in page, a forgot-password page and a reset page on the public website;

all on the existing Supabase Auth project, with no second identity store and with no weakening of
approval.

The website and Core are separate origins (ADR 0016). Both use the one Supabase Auth project.
Its configuration (2026-10-20, staging) allows public sign-up and requires email confirmation.
The owner set the project's password minimum to **8 characters**, for members and administrators
alike.

## Decision

### The password goes only to Supabase Auth

- **Order.** The website first submits the application to Core exactly as before; the request has
  no password field. Only after Core accepts it does the browser call Supabase Auth's own
  `signUp` with the password. Supabase emails the confirmation link and owns hashing, policy and
  rate limits. Core never receives, stores, hashes, logs or forwards a password.
- **Why this order.** A refused application (duplicate, member, rate limit, invalid) creates no
  account. If sign-up fails afterwards, the application stands: the applicant can retry from the
  confirmation screen, and if they never do, approval falls back to the existing invitation.
- **Existing accounts.** For an address that already has an account, Supabase answers sign-up
  without creating anything (with confirmation on), so nothing about the account is revealed. The
  person keeps their existing password.

### Linking only through a confirmed email

Migration `0027_membership_member_accounts` adds `membership_applications.auth_user_id` and
links an application to an Auth identity only when that identity's email is confirmed, or Core
itself invited it:

- `private.get_my_membership(user)`, for the signed-in person:
  - an unconfirmed email sees and links nothing;
  - on the first confirmed sign-in, the latest unlinked application with that email is linked
    (audited as `membership.account_linked`; the review revision is untouched);
  - if reviewers already approved it and activation was waiting, activation completes now
    (audited, `reviewer: "applicant"`);
  - it returns the member state and the latest application's stage, dates and activation. No note,
    reviewer, student ID or document is returned.
- `private.activate_membership`, the reviewer path:
  - a self-registered identity whose email is unconfirmed returns `EMAIL_UNCONFIRMED`; nothing is
    attached and no invitation is sent over it;
  - a confirmed identity is linked without any email;
  - an application with no account still returns `NEEDS_INVITATION`, so older applicants get the
    invitation as before.

**Why confirmation is required.** Anyone can start a sign-up with someone else's address. Such an
account stays unconfirmed until the mailbox owner acts, so it can never be attached to a
membership.

### Sign-in proves identity, not membership

- **Status endpoint.** `GET /v1/me/membership` takes the visitor's Supabase access token as a
  Bearer header. Core verifies it with Supabase Auth `getUser` (ADR 0015's actor rule) and asks the
  database about that identity only. CORS is exact-origin, GET with `Authorization`, no
  credentials. Only this route widens the allowed headers.
- **No new privileges.** A signed-in account without a `members` row is not a member. An account
  without `administrative_access` has no admin rights, exactly as before (ADR 0013). Approval
  still needs reviewers and the recorded policy, and nothing in this flow approves anything.
- **Pages.**
  - `/login` shows the person's stage: under review, verified, approved, not approved, member, or
    no application.
  - `/forgot-password` gives the same answer for every address.
  - `/reset-password` shows its form only after Supabase verifies the recovery link in that page
    load, and signs out every session after a change.
  - Auth links are removed from the address bar before use, and the pages send
    `Referrer-Policy: no-referrer`.
- **Sessions.** Sessions live in the visitor's browser: `sessionStorage`, or `localStorage` with
  "keep me signed in". Members do not sign in to Core's admin; if they try, Core's existing
  no-access page answers.

### Emails and redirects (Supabase project configuration)

Website origins must be on the redirect allow-list:

- `<site>/login` (signup confirmation);
- `<site>/reset-password` (recovery).

The recovery and signup-confirmation templates should link to
`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=<type>`:

- the website asks for its own pages;
- Core keeps asking for `<origin>/auth/callback`, so admin recovery is unchanged;
- an email sent without a redirect lands on Core's root, which forwards a well-formed link to
  `/auth/callback`.

The website also accepts the provider's default `{{ .ConfirmationURL }}` links.

## Consequences

- No password, hash or token is ever stored in a Core table, log, audit row or response.
- An applicant whose sign-up never completed is still served by the invitation, so nothing
  depends on the browser step succeeding.
- With public sign-up on, anyone can create an Auth identity. Each one has no membership and no
  access until the database grants them, and Technical's `/admin/access` directory lists them.
- Leaked-password protection needs a Supabase Pro plan and remains off. 8 characters is the
  owner's chosen floor.
- Configuration changes on the Supabase project (allow-list, templates, the minimum length on
  each project) are owner actions, recorded in `docs/AUTH_AND_EMAIL.md`.
