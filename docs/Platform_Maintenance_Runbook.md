# Platform access and recovery runbook

ADR 0012 and [ACCESS_CONTROL.md](ACCESS_CONTROL.md) define the current
application hierarchy. This runbook covers the external maintenance procedure
and operational recovery. Historical manager-grant procedures from migration
0010 were retired by migration 0016. No password, token, connection string or
recovery link belongs in this document, git, logs or chat.

## Authority

| Access                             | Where managed                                                  | Scope                                              |
| ---------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| Committee Manager                  | Technical Team at `/admin/access`                              | Exactly one committee                              |
| Board Administration               | Technical Team at `/admin/access`                              | Global operational                                 |
| Technical Team                     | Technical Team at `/admin/access`; external bootstrap/recovery | Global application                                 |
| Infrastructure/project maintenance | Supabase/Vercel/GitHub administrators                          | Database security, secrets, migrations and hosting |

The Technical Team committee row is an ordinary event owner; it does not
confer the `TECHNICAL` access level. Do not infer access from names, emails,
Auth metadata or legacy grants. The former `Events` manager has no automatic
destination in this hierarchy.

Migration 0017's `private.access_auth_users` view projects only Auth user IDs
and emails for private routines. It is owned by `postgres`; browser roles have
no SELECT privilege. Never expose the view through the public API.

## Technical bootstrap and recovery

1. Verify the requested person's identity and the approved access change
   outside the application. Select their **existing, real** Supabase Auth user
   ID. For a first bootstrap, the maintenance actor may be that same real Auth
   user. Do not create a placeholder user.
2. Confirm a restorable backup, current migration version and target project.
   Rehearse the routine in staging before production. Use the managed
   `app_maintenance` connection from the secret store, never a browser key.
   If that login is unavailable, a verified Supabase project maintainer may
   invoke the same fixed routine from the privileged SQL executor. Record the
   exception and result; do not write to the access table directly. Production
   initial bootstrap used this fallback because the managed connection cannot
   `SET ROLE app_maintenance`.
3. Call the fixed routine in one transaction:

   ```sql
   SELECT private.set_technical_access(
     :maintenance_actor_auth_user_id,
     :target_auth_user_id,
     true,
     :approved_change_note
   );
   ```

   Use `false` only for exceptional recovery revocation. `SUCCESS` means the access row and
   audit row committed together. `ALREADY_ACTIVE`, `CONFLICT`, `NOT_FOUND`,
   `USER_NOT_FOUND`, `ACTOR_NOT_FOUND` and `LAST_TECHNICAL_ADMIN` mean no change; reconcile identity and
   state before retrying. Never change `administrative_access` directly.

4. Read back the target's access level and `revoked_at`, then inspect the
   `technical.granted` or `technical.revoked` audit row. Have the named person sign in and
   verify global access and `/admin/access`. A Board or Manager account must
   be denied the Technical screen and routine.
5. To recover from loss of all Technical accounts, a verified external
   maintainer repeats this procedure for one named Auth user. Do not use a
   hardcoded email, reset a password as an access workaround, or grant a
   committee named Technical Team to simulate the role.

## Technical ownership transfer

An active Technical administrator opens `/admin/access`, selects an existing
Auth user, chooses **Technical Team**, and confirms the grant of full
application authority. The database verifies the actor and target, grants
access and records `technical.granted` atomically. Have the new person sign in,
verify global scope and access management, then use **Revoke Technical access**
on the old account if requested. `technical.revoked` records both states.
`LAST_TECHNICAL_ADMIN` blocks removal of the final active Technical identity,
including self-removal. Do not edit source code, environment variables or
database rows to replace a person. The external routine remains available only
for bootstrap or verified recovery.

## Board and Committee Manager access

An active Technical user opens `/admin/access`, selects an existing Auth user,
chooses Board Administration or Committee Manager, and selects **one**
committee for a manager. The server and database routine recheck Technical
authority. A manager already assigned elsewhere returns `REASSIGN_REQUIRED`;
use the explicit Reassign action to atomically replace the committee ID.
Revoke leaves the access row and audit intact. Board users cannot perform any
access change, including to themselves. Manager revocation, reassignment and
Board revocation use the same confirmed UI actions. Their respective audit
actions are `manager.assigned`, `manager.reassigned`, `manager.revoked`,
`board_admin.granted` and `board_admin.revoked`.

To add a manager later for Forum, Evening, Relations or Society Affairs,
select or create the **real** Auth user, then use the same workflow and select
that committee. No route, migration or RLS policy changes. To add a new
committee, insert a unique stable slug and display name as reviewed catalog
data, then use this same workflow. Do not authorize by display name.

## Audit inspection

`/admin/access` shows the latest 100 access audit records to Technical users.
The private `list_access_audit` routine enforces the role and returns actor,
target, action, committee, previous and new state, timestamp and optional
note. For deeper incident review, an authorized database maintainer may read
`private.uc02_audit` with a scoped query. Keep actor and target Auth IDs and
committee IDs in the record; do not copy attendee exports or credentials into
the note. Approval and rejection records also live in `private.uc02_audit`
with event and committee IDs, review states and time.

## Password and project recovery

`/admin/recovery` sends the user's normal recovery email, and `/auth/reset`
changes their password. Password recovery does not change access. If an inbox
is lost, external maintenance verifies identity before changing the Auth
address or provisioning a replacement. If project-owner access is lost, use
Supabase organization recovery. Rotate suspected compromised database,
Supabase, Vercel and GitHub credentials through their secret managers, then
inspect recent access and authentication audit history.

If recovery displays a temporary sending error, check Supabase Auth logs for
`/recover` and its error code. `over_email_send_rate_limit` means no message was
sent; wait for the project's email quota to clear before one new request.
Do not repeatedly retry, change passwords through the Auth admin API, or mark a
role pilot verified merely because Auth recorded a login. The account holder
opens the recovery link and sets their password privately, then verifies the
appropriate admin screens.

## Production order

Complete the local and staging rehearsal, production drift and backup checks,
then apply the reviewed migration. Pilot one real Technical, one real Board
and one real Committee Manager identity, testing positive and negative paths.
The owner has withdrawn the earlier Support placeholder; it was revoked and
cannot be used for the manager pilot. Wait for the real Support identity.
The Technical Team lead assigns Support & Logistics, Finance and Media through
`/admin/access` after the pilot, using real users they select. Forum, Evening,
Relations and Society Affairs remain without
ordinary managers. Do not deploy the new application code against an
unmigrated production schema. After backup and migration safety checks, apply
the reviewed 0020 archive migration to the confirmed M8 smoke row. It retains its archived
records and audit relationships. Staging has non-smoke `Events` data, so 0020
correctly leaves that staging row untouched.
