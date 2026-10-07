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

Request recovery from production `/admin/recovery`. The live recovery template
uses a token hash sent to `/auth/callback`, so it can complete on another device.
The alternative PKCE-code flow requires the requesting browser's verifier.
Dashboard/default-template links may deliver a fragment; the existing relay
removes it before completing the session. Never share a recovery URL. If exposed,
globally sign out the affected session, discard the link, request a fresh email,
and remember that already issued access tokens can remain valid until expiry.

For a sending error, inspect Supabase Auth `/recover` and Resend delivery logs.
`over_email_send_rate_limit` means the request did not send mail; wait before
retrying. The current custom SMTP interval is 60 seconds and hourly quota 30.
The account holder sets the password privately and signs in; an Auth login record
alone is insufficient evidence of the correct admin screens.

## Production order

Complete local/staging rehearsal, inspect production drift and backup capability,
then apply a reviewed migration. Pilot real Technical, Board and Manager accounts
with positive and negative paths. Current October 7 identities are recorded in
`CURRENT_WORK.md`: Support, Finance and Media each have one live assignment.
Support's invitation is still unaccepted at inspection. Do not reinstate obsolete
placeholder decisions from the dated October 4 notes.

Production already has migrations through 0022. The legacy Events committee and
its five archived M8 smoke events remain isolated and have no active manager
grant. Do not map them to a final committee, delete their history, or rerun the
0020 archive migration. Any future fix is a new migration; verify the exact target
and journal before applying it.

## Failure diagnosis

| Symptom                              | First evidence to inspect                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login, callback or recovery failure  | Supabase Authentication logs, then Vercel function logs for the route; never copy a token or full recovery URL into an incident note.                                                 |
| Email accepted but absent from inbox | Supabase Auth SMTP result, Resend delivery/bounce/complaint events, then sending-domain SPF/DKIM/DMARC.                                                                               |
| Access denied unexpectedly           | `/admin/access` grant state and `private.uc02_audit`; compare the actor's live Auth ID with the access row. Check committee RLS under real `request.jwt.claims`.                      |
| Event or registration action fails   | Vercel function logs, the returned domain error code, then the scoped database routine and audit row. The `app_runtime` role cannot inspect tables directly.                          |
| Migration failure                    | GitHub commit, migration journal, database error, and the pre-change backup; stop before rerunning a partially applied change.                                                        |
| Deployment failure                   | GitHub Actions CI run and Vercel deployment build/runtime logs for the exact commit SHA.                                                                                              |
| Auth administration audit failure    | Vercel `auth_admin_audit_failed` log. The Auth API change can have succeeded before its separate database audit write; reconcile the target's live Auth state and record an incident. |

## Backup and isolated recovery

The October 4 pre-access logical archive recorded in `CURRENT_WORK.md` was
validated with `pg_restore --list` and a full decode. It is historical evidence,
not a current recovery point. Supabase previously reported WAL archiving but no
listed physical backup or proven PITR window. Do not claim a disaster-recovery
objective or a successful production restore from that evidence.

Before a destructive schema or data change, confirm the project's current
backup entitlement and retention in Supabase, take a fresh restorable logical
backup outside this repository, inspect its archive, and restore it to an
isolated PostgreSQL instance. Apply pending migrations there, run the database
security suite and verify row counts, key relationships, grants and audit.
Review the rollback or forward repair for the exact migration before applying
it to production. Never restore into the live project as a rehearsal.

### Supported log access (verified October 7, 2026)

- Vercel: select `eng-crafters` > `engsoc-platform` > Logs, filter Production,
  route and incident time. The current connector identity returns 403 because
  it lacks that team scope. The owner's separately authenticated CLI works:
  `vercel --scope eng-crafters logs --project engsoc-platform --environment production --since 1h --limit 100 --json --no-follow`.
  A limited result is not the whole incident window. Never print raw token-bearing
  request URLs; reduce logs to error codes, timestamps, route paths and IDs.
- Supabase: project > Logs Explorer, select Auth, Postgres or pooler. The current
  CLI/Management API identity can query them. Connection/disconnection logging
  is off, DDL-only statement logging and no pgAudit limit retrospective evidence.
- Resend: Emails > select the message > delivery events; Domains > `auth.essqu.com`
  for SPF/DKIM. The owner browser session works. The locally available API key is
  invalid and is not used by the application's SMTP Auth flow.
- To restore connector access, the owner reconnects it with an account that has
  the existing team permission. Do not broaden production permissions for logging.

### Reconcile partial Auth administration

1. Stop repeating the operation. Record the timestamp, actor/target Auth IDs,
   action and fixed failure code from `auth_admin_audit_failed` or
   `auth_admin_access_unconfirmed`; never record a password or recovery link.
2. A currently authorized Technical user refreshes `/admin/access` and inspects
   identity, grant and history. Compare Supabase Auth logs and Resend delivery
   events for the original attempt. A missing response does not establish that
   the underlying operation failed.
3. If an account exists without the intended grant, use **Assign role** on that
   account after confirming the intended scope. If the grant is already present,
   retain it. Do not create the account again. Grant/revoke and their audit writes
   are one transaction and should not be reconstructed independently.
4. For a proven external Auth success with missing audit history, a current
   Technical actor may use the fixed `private.record_auth_admin_action` routine
   through the authorized runtime path with that actor's ID, the original target,
   the permitted action label, and fixed detail `reconciled`. Preserve the original
   incident time/actor in the private incident record; the reconciliation row
   honestly records its current actor and time. Check for an existing row first.
5. If the original Auth outcome cannot be proven, record that uncertainty rather
   than fabricate success. A new email/password action is a separate deliberate
   operation after confirming the account holder's need.

### Credential rotation and target verification

Identify the project from the parsed connection host/username; never assume
`.env.local` means staging. The October 7 exposed migration credential targeted
production. Rotate through Supabase Database settings or the supported Management
API database-password endpoint, keeping values in memory/private secret stores.
Update every known consumer, verify a new connection, and verify the former
password is rejected. Review logs and state their coverage limits. Rotation does
not itself prove old established sessions were terminated.

For this incident the updated consumers were local ignored `DATABASE_URL` and
Vercel Development `DATABASE_URL`; unused Preview storage was removed. Production
runtime uses its separate `APP_RUNTIME_DATABASE_URL`. GitHub had no repository
secrets, and the supported Supabase CLI project password entries were absent.
The new connection succeeded and the old one returned SQLSTATE `28P01`. No
credential match occurred in the 824 reachable Git blobs scanned. Do not save
credentials in command arguments, documentation, screenshots or logs.

### Recovery evidence (October 7, 2026)

The live backup API reports PITR disabled, WAL archiving enabled, and no listed
physical backups/retention window. A paid recovery capability is not assumed.
A full custom-format logical archive was stored outside git at
`%LOCALAPPDATA%/engsoc-platform/backups/readiness-2026-10-07.dump`. Its checksum
and inspection evidence are in `HARDENING_AUDIT_2026-10-07.md`.

A full restore with `pg_restore --exit-on-error` succeeded in a disposable
Supabase PostgreSQL 17.6 instance. Restore as the local `supabase_admin` role;
create missing role identities first, preserving NOLOGIN for routine owners and
assigning new isolated credentials to login roles. Do not copy production role
passwords or use `--no-owner`/`--no-acl` to hide grant problems. Verify Auth users,
business row counts, RLS/FORCE flags, routine owners and grants. This rehearsal
also verified last-Technical rejection, second-Technical grant and Board denial
in rolled-back transactions.

This proves restoration of that database snapshot only. It does not restore
hosted Auth settings, external secrets, Storage object files or deployment
configuration; it does not establish a timed disaster-recovery objective. The
local archive contains sensitive data and requires restricted access and secure
retention. Before future schema changes, take a fresh archive and repeat the
isolated check. On migration failure, inspect the journal and transaction outcome;
prepare a reviewed forward correction or an isolated restore/cutover plan. Never
rerun destructive SQL or overwrite production as a diagnostic step.
