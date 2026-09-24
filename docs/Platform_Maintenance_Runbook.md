# Platform maintenance and ownership runbook

**Scope:** who holds authority over the Engineering Society platform, how the
first committee manager is provisioned, and how access is recovered or
transferred. **Source of truth:** `docs/UC-02_Data_and_Security.md` §4 and §6,
`docs/UC-02_Deep_Dive.md` §5, `db/README.md`, and
[ADR 0009](adr/0009-external-platform-maintenance-authority.md). This runbook
restates and operationalizes them; it adds no new role, table or permission.

No secret, password or recovery link belongs in this file, in git, in logs or in
chat. Record who did what and when, never the credential.

## A. Current authority model

| Authority                        | What it is                                                                                                                            | Where it lives                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Committee manager**            | An Auth user with an active row in `committee_managers` for one committee. The highest role the application knows.                    | Database (`committee_managers`), per request  |
| **Platform maintenance (owner)** | Whoever can administer the Supabase project and run the `app_maintenance` database role. **Not** an application role, table or claim. | Outside the app: Supabase org/project, secret |

- There is **no application-level super-admin or owner**. Nothing in the
  database, cookies, user metadata or code represents platform ownership, and
  no email address is hardcoded into authorization logic.
- Committee managers cannot grant, revoke or delegate access, not even their own.
- Application credentials (`app_runtime`, the browser's anon key) cannot
  provision anything. Maintenance actions use a separate, audited procedure run
  by a person with maintenance authority.
- The signed-in UI labels every user **Committee manager** and never "Owner".
  `/admin/account` shows the identity, active committee scopes and this
  explanation.

## B. Manager grants and first-manager bootstrap

Run against **staging first**. Never run this against production without the
authorized production procedure, and never seed blanket grants.

Grants are created and revoked only by two fixed, maintenance-only database
routines (migration `0010`). The routine writes the grant and its audit row in
one transaction, so the audit trail cannot be forgotten or half-written, and
`app_maintenance` no longer has direct INSERT/UPDATE on `committee_managers` or
INSERT on `private.uc02_audit`.

| Routine                                                                        | Effect                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `private.grant_committee_manager(p_actor, p_user_id, p_committee_id, p_note)`  | Grants, or re-activates a revoked grant. Audits it.    |
| `private.revoke_committee_manager(p_actor, p_user_id, p_committee_id, p_note)` | Revokes an active grant, retaining the row. Audits it. |

Only `app_maintenance` (and the Supabase project owner) can execute them.
`app_runtime`, `anon`, `authenticated` and `service_role` cannot, and no
application code calls them. Both return a `jsonb` result:

| `code`                          | Meaning                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `SUCCESS`                       | Changed. `change` is `granted`, `reactivated` or `revoked`.              |
| `ALREADY_ACTIVE`                | Grant already active. Nothing changed, nothing audited.                  |
| `ALREADY_REVOKED` / `NOT_FOUND` | Revoke found no active grant. Nothing changed, nothing audited.          |
| `USER_NOT_FOUND`                | `p_user_id` is not an Auth user. Nothing changed.                        |
| `ACTOR_NOT_FOUND`               | `p_actor` is not an Auth user. Nothing changed.                          |
| `COMMITTEE_NOT_FOUND`           | Unknown committee. Nothing changed.                                      |
| `VALIDATION_ERROR`              | A required argument was null, or `p_note` is longer than 200 characters. |

### Who is `p_actor`? (attribution contract)

`committee_managers.granted_by` and the audit `actor_user_id` both require a real
`auth.users` id. So **every maintainer needs their own named Auth user** (create
it like any other user, section 1 below). That user is an _attribution identity
only_: it holds no grant, has no application privilege, and is not a hidden owner
or super-admin. Pass it as `p_actor`. Never use a shared or placeholder id.

If the maintainer is also the first manager, `p_actor` and `p_user_id` may be the
same Auth user. The audit row still records `actor_kind = 'maintenance'`.

### First-manager bootstrap

There is no separate bootstrap mechanism, only the same routine, made
recognizable in the audit history:

- The routine sets `changes.bootstrap = true` itself when the committee has **no
  active manager** at that moment. The caller cannot assert or fake it.
- Pass a `p_note` saying why (for example `first Events manager, approved by the
board on 2026-09-21`). It is stored in `changes.note`.
- A future maintainer answers "who granted the first manager, and why" with:

  ```sql
  SELECT occurred_at, actor_user_id, changes
  FROM private.uc02_audit
  WHERE committee_id = :committee_id AND action = 'grant.activated'
  ORDER BY occurred_at, id;
  ```

  The first row with `bootstrap: true` names the maintainer (`actor_user_id`), the
  manager (`changes.userId`), and the reason (`changes.note`).

No email address or user id is ever written into application code, environment
variables or migrations. Authorization is always the database row.

### Procedure

1. **Create the Auth users** (maintenance authority): Supabase dashboard →
   Authentication → Users → _Add user_, or invite by email. Use each person's real
   address; no shared accounts. Do this for the manager and, once, for yourself
   as maintainer.
2. **Confirm the email.** Prefer the invitation/confirmation email so the person
   proves inbox control. Confirm manually in the dashboard only after verifying
   the person out-of-band. Login requires a confirmed email; there is no signup.
3. **Identify the committee** by its `committees.id` (seeded; no create/rename UI).
4. **Grant**, connected as `app_maintenance` (connection string from the
   maintenance secret store, never committed):

   ```sql
   SELECT private.grant_committee_manager(
     :maintainer_user_id, :manager_user_id, :committee_id,
     'first Events manager, approved by the board'
   );
   ```

   Expect `{"code": "SUCCESS", "change": "granted", "bootstrap": true}`. Any other
   code changed nothing; fix the input and rerun. The call is safe to repeat.

5. **Verify.** Read-only checks (`app_maintenance` keeps SELECT):

   ```sql
   SELECT user_id, committee_id, granted_at, granted_by, revoked_at
   FROM public.committee_managers WHERE user_id = :manager_user_id;
   ```

   Then have the manager sign in at `/admin/login`: the shell must show their
   email, "Committee manager" and the committee.

## C. Password recovery

- **Recommended (the supported path):** the person opens `/admin/recovery` and
  enters their email → Supabase sends a recovery email → they open the link **in
  the same browser** → `/auth/callback` exchanges the code → they choose a new
  password (at least 12 characters) at `/auth/reset`. The response is deliberately
  generic and never confirms whether an account exists.
- **Recovery changes authentication only.** It never creates, restores or alters a
  committee grant. A user without an active grant still sees "No committee access
  assigned" after a successful reset, and a manager keeps exactly the grants they
  had.
- **Fallback, unverified:** a maintainer can trigger a recovery email from the
  Supabase dashboard → Authentication → Users → the user. **This is not
  equivalent to the in-app path until it has been tested on staging.** The
  in-app path starts the flow from this app's browser session; a dashboard-sent
  link may not complete through `/auth/callback` (code exchange). Do not rely on
  it in an emergency until you have run it on staging and recorded the result
  here. No recovery email was sent to verify it during this work.
- **Email delivery:** Supabase's built-in mailer is for testing (heavily
  rate-limited, restricted recipients). Real recovery needs the configured Resend
  SMTP integration, an allowlisted `AUTH_REDIRECT_ORIGIN` callback, and working
  sender-domain DNS. Confirm all three before promising recovery.

## D. Lost access: who fixes what

| Situation                                    | What is broken                            | Correct path / authority                                                                                                                               |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Forgot password**                          | Sign-in only                              | The user, via `/admin/recovery`. If email is not arriving, maintenance checks SMTP and rate limits.                                                    |
| **Lost access to the email inbox**           | Ability to prove identity                 | Cannot be self-served. Maintenance authority verifies the person out-of-band, then updates the Auth user's email (or provisions a new user and grant). |
| **Committee grant revoked / missing**        | Authorization (sign-in still works)       | Maintenance authority re-grants with the grant routine (section B). A password reset does nothing here.                                                |
| **Supabase / project-owner access lost**     | The maintenance authority itself          | Supabase account recovery and organization ownership (section E). Not solvable from inside this app or by any manager.                                 |
| **Maintenance credentials suspected leaked** | Trust in `app_maintenance` / service keys | Rotate immediately (section E), then review recent `grant.activated` / `grant.revoked` rows in `private.uc02_audit`.                                   |

## E. Ownership transfer

Application ownership does not exist, so **operational ownership is transferred,
not reassigned in a table.** No database row may pretend to represent platform
ownership.

1. **Add the new maintainer** to the Supabase organization/project with the
   needed role (invitation from the current owner). Where the organization has a
   single owner, use Supabase's organization ownership transfer.
2. **Hand over secrets through a secret manager**, never chat or git: the
   `app_maintenance` connection secret, and any Vercel/Supabase tokens the role
   requires.
3. **Rotate credentials** the outgoing maintainer knew:
   `ALTER ROLE app_maintenance WITH PASSWORD '<new value from the secret manager>'`,
   then `app_runtime`, then service/API keys and tokens (Vercel env vars,
   GitHub secrets). Redeploy so the app picks up new values.
4. **Remove the outgoing maintainer** from the Supabase org/project, Vercel
   project and GitHub repository.
5. **Audit committee grants** and confirm they match intent:

   ```sql
   SELECT cm.user_id, u.email, c.name, cm.granted_at, cm.granted_by, cm.revoked_at
   FROM public.committee_managers cm
   JOIN auth.users u ON u.id = cm.user_id
   JOIN public.committees c ON c.id = cm.committee_id
   ORDER BY c.name, u.email;
   ```

   Review recent `grant.activated` / `grant.revoked` rows in
   `private.uc02_audit` (`changes.bootstrap` marks a committee's first manager).

6. Record the transfer (date, from, to) in `docs/CURRENT_WORK.md`, with no secrets.

## F. Manager grant revocation

Revoking a `committee_managers` grant removes that person's **application**
access to that committee, effective on their next request (grants are read from
the database every time). It does **not** delete their Auth account, and it does
**not** change any external maintenance or platform ownership: those are not in
that table, so a maintainer who is also a committee manager keeps full
maintenance authority when their grant is revoked, and losing a grant can never
destroy platform ownership.

Revoke with the maintenance-only routine. It retains the row (never deleted),
records `revoked_at` / `revoked_by`, and writes the `grant.revoked` audit row in
the same transaction:

```sql
SELECT private.revoke_committee_manager(
  :maintainer_user_id, :manager_user_id, :committee_id,
  'left the Events committee'
);
```

Expect `{"code": "SUCCESS", "change": "revoked"}`. Repeating it returns
`ALREADY_REVOKED`; an unknown grant returns `NOT_FOUND`; neither writes anything.
To restore access later, call the grant routine again: it re-activates the same
row and records the previous state under `changes.previous`.

## G. Permission matrix

| Action                                                                         | Committee manager (own committee) | Committee manager (other committee) |       Maintenance authority       |
| ------------------------------------------------------------------------------ | :-------------------------------: | :---------------------------------: | :-------------------------------: |
| View, create and edit events (incl. drafts, archived)                          |                Yes                |                 No                  |     Via database, not the UI      |
| Publish, hold full, reopen, archive, restore (subject to the O-01 review rule) |                Yes                |                 No                  |                 -                 |
| Approve another manager's flagged draft on the same committee                  |                Yes                |                 No                  |                 -                 |
| View registrations, promote waitlist, event-scoped CSV                         |                Yes                |                 No                  |                 -                 |
| Read the scoped event audit history                                            |                Yes                |                 No                  |                 -                 |
| Hard-delete events, rewrite or remove audit rows                               |                No                 |                 No                  |                No                 |
| Platform-wide export                                                           |                No                 |                 No                  |       Not in current scope        |
| Grant, revoke or change committee-manager access                               |                No                 |                 No                  |              **Yes**              |
| Create Auth users, confirm emails, send dashboard recovery                     |                No                 |                 No                  |              **Yes**              |
| Rotate `app_maintenance` / `app_runtime` passwords and service keys            |                No                 |                 No                  |              **Yes**              |
| Run migrations                                                                 |                No                 |                 No                  | **Yes**, via authorized procedure |
| Transfer operational ownership (Supabase/Vercel/GitHub access)                 |                No                 |                 No                  |              **Yes**              |

Anything not listed is denied. The authoritative permission model is
`docs/UC-02_Data_and_Security.md` §6; if this table ever disagrees, that
document wins and this one is fixed.

## Answers at a glance

### M8 production release gate (September 24, 2026)

The owner selected original main `rbeyqrfypowyocmnmvwu` for production. It
was resumed and is active. Live inspection found ENABLE and FORCE RLS already
present on all ten UC-02 tables, correcting the older preflight. A main schema
and data dump was taken before additive migrations 0007–0015 were applied.
The post-apply catalog has the expected private routine owner, fixed search
paths and grants. Vercel Production still targets staging
`wnrdgnmmcdedmilnzzsl`; switch only after initial main manager provisioning,
real-role checks and a coordinated deployment smoke. The main runtime role's
existing password is unavailable in this workspace. Vercel CLI under
`eng-crafters` can inspect Ready deployments even though the MCP connector
receives a team-scope 403.

- **Who is the platform owner?** Whoever holds Supabase project/organization
  authority and the `app_maintenance` secret. It is a person or team outside the
  app, not a database row or role.
- **How is the first owner created?** Creating the Supabase project makes its
  creator the owner. The first manager is then bootstrapped with the grant routine (section B).
- **How does the owner recover access?** Supabase account recovery for the
  project/org; section C and D for application accounts.
- **How is ownership transferred?** Section E.
- **How is a manager different from the owner?** Manager: one committee's events
  and registrations, read from a database grant. Owner: provisioning and
  credentials, outside the app.
- **What if the owner's committee grant is revoked?** Nothing happens to
  ownership (section F).
- **Which actions need owner-level authority?** The bold rows in section G.
