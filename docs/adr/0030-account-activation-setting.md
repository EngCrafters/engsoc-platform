# 0030 — Account activation setting: email confirmation or immediate

Status: accepted (owner direction, 2026-11-23). Adds a setting beside ADR 0029's approval
policy; changes ADR 0019 only for registrations made under the new `immediate` mode.
Related: ADR 0013 (identity vs. access), ADR 0015 (trusted server actor, Auth Admin module),
ADR 0017, ADR 0019 (member accounts), ADR 0027 (permissions), ADR 0029 (automatic approval),
migration `0038_account_activation_setting`

## Context

Under ADR 0029 a registration is approved at once, but the account works only after the
registrant clicks the confirmation email (ADR 0019), because Supabase Auth's "confirm email"
setting is on for the whole project. The owner asked administrators to choose, from
`/admin/membership`, between:

- **email confirmation** (as now): the registrant confirms the address, then signs in; and
- **immediate activation**: no confirmation email; the account and membership are active at
  once and the registrant can sign in with the chosen password.

The choice must persist in the database, apply to the next registration without a deployment,
be audited, stay separate from the approval policy, and must not fake verification, disable
security globally or expose the service-role key.

Supabase offers no per-registration switch on the public sign-up: with confirmation on, every
`signUp` sends a confirmation email. Turning confirmation off for the project would also stop
confirming every other account (administrators included) and is a hosted setting outside this
code. The supported per-account mechanism is the server-side Admin API: `createUser` with
`email_confirm: true` creates a usable account and sends nothing.

## Decision

### The setting

`private.membership_settings.account_activation` is `email_confirmation` (default) or
`immediate`. `private.set_membership_account_activation` changes it for holders of
`settings.membership_policy` (the permission that already guards the approval policy; held by
Technical and, since migration 0039, Board Administration: see below), and writes
`membership.policy_changed` with `setting: "account_activation"`, the previous and the next value.
The registration routine stores the mode in force on the application
(`membership_applications.account_activation`) and returns it, so each registrant gets the flow
the website announced, even if the setting changes a second later. `GET /v1/membership-options`
also reports it, for the form's wording only.

The approval policy is untouched: under a reviewed policy, an immediate account exists at once
but the membership still waits for approval.

### Immediate activation: the password never reaches Core

1. The browser submits the application as before (`POST /v1/membership-applications`) and gets
   `accountActivation: "immediate"`.
2. It sends its 256-bit status token to `POST /v1/membership-applications/account`.
3. `private.begin_immediate_account` checks, in the database: the application was submitted under
   `immediate`, less than an hour ago, is not rejected, and its email has **no** Auth account. It
   reserves an account ID (`membership_applications.immediate_account_id`) and returns it with the
   email. The request supplies neither.
4. Core creates that account through the Auth Admin module (`createUser` with the reserved ID,
   `email_confirm: true`, no password; no email is sent), then
   `private.complete_immediate_account` re-checks everything, links the account to the application
   (`membership.account_linked` with `emailVerified: false`) and, if the application is approved,
   writes the member record.
5. Core generates a magic-link token for that account (Admin `generateLink`, which sends no
   email) and returns only its hash.
6. The browser signs in with it (`verifyOtp`) and sets the chosen password with Supabase Auth
   (`updateUser`). The password goes from the browser to Supabase Auth only, as in ADR 0019.

A sign-in token is produced only for the account Core reserved and created, only while that
account has never signed in, and only within the hour. An address that already has an account
(an administrator, an earlier registrant) is never adopted, linked or signed in to: the endpoint
answers `account-exists` and the website asks the person to sign in with their existing
password. A retry after a partial failure finds the reserved account by its ID.

If this server has no service-role key, the endpoint answers `503 not-configured` and the website
falls back to the ordinary sign-up with a confirmation email; the dashboard disables the
immediate option and says why.

### Honesty about verification

The Admin API records the address as confirmed; it was not verified. The application says so
(`account_activation = 'immediate'` and `immediate_account_id = auth_user_id`), the audit row says
`emailVerified: false`, and the dashboard shows "Created at registration without email
verification" on the application.

### Who may change the membership settings (owner decision, 2026-11-23, migration 0039)

The owner's own administrator account is Board Administration, which could see both settings but
change neither: `settings.membership_policy` was mapped to the Technical level only (ADR 0017,
0035's fixed mapping). Migration 0039 adds it to Board Administration as well, so Board and
Technical can change **both** the approval policy and account activation. The permission is
renamed "Membership settings" in the catalog and the dashboard. Committee Managers, leaders and
every other permission are unchanged; each change is still re-checked by the database and audited.
This supersedes ADR 0017's "Only a Technical user can record the setting".

## Consequences

- Under `immediate`, anyone can register an address they do not own and get a member account for
  it. The real owner can take the account back through "Forgot password", which emails the real
  mailbox. Registration still grants no permission, level, committee place or leadership.
- Under `immediate`, the `account-exists` answer tells the registering browser that the address
  already has an account (the confirmation flow does not reveal this). It is limited by the
  five-per-hour registration limit, and each probe leaves an application visible to reviewers.
- Core calls the Auth Admin API from a public endpoint for the first time (ADR 0015 kept it behind
  Technical actions). The call is bounded by the database checks above and needs
  `SUPABASE_SERVICE_ROLE_KEY` on the server only.
- Email confirmation remains the default and the recommended setting.
