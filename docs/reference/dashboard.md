# Dashboard reference

Core's administration dashboard lives under `/admin`, with Supabase Auth pages under `/auth`. This
document lists every page and server action with its access requirement and enforcement point
(**Source**). Role definitions and the full permission matrix are in
[Roles and permissions](roles-and-permissions.md).

## How access is decided

1. [`proxy.ts`](../../proxy.ts) runs on `/admin/*` and `/auth/*`. When a Supabase auth cookie
   exists, it refreshes the session (`supabase.auth.getClaims()`).
2. [`app/admin/(protected)/layout.tsx`](<../../app/admin/(protected)/layout.tsx>) calls
   `getManagerContext()` ([`lib/auth/manager.ts`](../../lib/auth/manager.ts)):
   - it verifies the user with `supabase.auth.getUser()` (cookie session);
   - it reads the caller's active row in `public.administrative_access` through the
     authenticated, RLS-protected Supabase client. The RLS policy only returns the caller's own
     rows;
   - it reads visible committees: all slugged committees for Board and Technical, or the managed
     committee for a Committee Manager.
3. The outcome:
   - not signed in: redirect to `/admin/login?next=/admin/events`;
   - signed in without active access: the `NoAccessState` page ("You're signed in, but this
     account does not currently have administrative access.");
   - otherwise the shell renders with the navigation for that level.
4. Each page and server action checks again (`getManagerContext`, `requireSenior`, or a Technical
   check). It then calls a `private.*` routine with the verified user ID as `p_actor`, and **the
   routine re-checks scope against live data**. UI visibility is never the security boundary.

## Pages

| Path                                          | Who can open it                                                               | Enforcement                                                                                                                | What it does                                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/login`                                | Anyone                                                                        | none (redirect target)                                                                                                     | Email and password sign-in (`loginAction`); `?next=` restricted to safe dashboard paths                                                                        |
| `/admin/recovery`                             | Anyone                                                                        | none                                                                                                                       | Requests a recovery email to `AUTH_REDIRECT_ORIGIN/auth/callback`; the same answer for every address                                                           |
| `/auth/reset`                                 | Holder of a live recovery session                                             | The page refuses without one                                                                                               | Choose and confirm a new password (`resetPasswordAction`)                                                                                                      |
| `/admin`                                      | Signed in                                                                     | Redirect                                                                                                                   | Redirects to `/admin/events`                                                                                                                                   |
| `/admin/events`                               | Any active access                                                             | Layout; `private.list_admin_events` and `private.count_admin_events` apply scope                                           | Event list with status filters and cursor paging; committee filter for Board and Technical                                                                     |
| `/admin/events/new`                           | Any active access                                                             | Layout; `private.save_event_details` checks committee scope                                                                | Create an event in an allowed, non-archived committee                                                                                                          |
| `/admin/events/[id]`                          | Any active access with the event in scope                                     | `private.get_admin_event` returns nothing out of scope, so 404                                                             | Details, editing, lifecycle panel. Review controls appear for Board and Technical only.                                                                        |
| `/admin/events/[id]/registrations`            | Same                                                                          | `private.count_admin_registrations`, `private.list_admin_registrations`                                                    | Registration list and counts, waitlist promotion, CSV export                                                                                                   |
| `/admin/events/[id]/attendance`               | Same                                                                          | `private.list_event_attendance`, `private.manage_event_checkin`                                                            | Open, rotate or close check-in; QR code; manual attendance; CSV                                                                                                |
| `/admin/membership`, `/admin/membership/[id]` | Membership reviewers: the Society Affairs Committee Manager, Board, Technical | `getMembershipAccess` → `private.get_membership_review_overview`, `private.can_review_membership`, and per-action routines | Application list, filters and history, the ID card viewer, verify, approve, reject, activate; the approval policy (Technical); name and student ID corrections |
| `/admin/projects`, `/admin/projects/[id]`     | Project reviewers: the Society Affairs Committee Manager, Board, Technical    | `private.project_read(…, review=true)` returns `FORBIDDEN` otherwise                                                       | Review queue; start review, approve with attestation, reject, request changes, publish, unpublish                                                              |
| `/admin/account`                              | Any active access                                                             | Layout                                                                                                                     | Own access summary                                                                                                                                             |
| `/admin/administration`                       | Board, Technical                                                              | `requireSenior()`; `private.admin_overview`                                                                                | Overview counts, permission matrix, pending account erasures (Technical)                                                                                       |
| `/admin/administration/committees` and `[id]` | Board, Technical                                                              | `requireSenior()`; `private.admin_list_committees`, `admin_get_committee`                                                  | Create, edit, archive and restore committees; roster; managers                                                                                                 |
| `/admin/administration/members` and `[id]`    | Board, Technical                                                              | `requireSenior()`; `private.admin_list_members`, `admin_get_member`                                                        | Member directory and details; permanent deletion (record: Board and Technical; account: Technical)                                                             |
| `/admin/access`                               | Board, Technical                                                              | `requireSenior()`; the Technical-only tools check again                                                                    | Accounts and access: directory, add or invite users, grants, replacement, suspension, history                                                                  |
| `/dev/design-system`                          | Development only                                                              | 404 when `NODE_ENV=production`                                                                                             | Component gallery                                                                                                                                              |

### Navigation visibility

[`components/admin/admin-sidebar.tsx`](../../components/admin/admin-sidebar.tsx) shows:

- **Events** and **Create event** to every active level;
- **Projects Management** to Board and Technical, and to a Committee Manager when the membership
  section is available to them (the Society Affairs manager);
- **Membership applications** only when the database confirms the caller is a reviewer, with an
  "awaiting a decision" badge. If the membership routines are missing, it shows a setup notice to
  the roles the rules name;
- **Society administration** (Overview, Committees, Members, Accounts & access) to Board and
  Technical.

The pages and routines enforce the same rules independently.

## Public pages served by Core

| Path           | Purpose                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Core's own public event list ([`app/(marketing)/page.tsx`](<../../app/(marketing)/page.tsx>)), registration through the server action below |
| `/events/[id]` | Core's own public event detail                                                                                                              |

These pre-date the separate website. Core's root also forwards a well-formed Auth link that lands
on the Site URL root to `/auth/callback` (`AuthHashRelay` in the root layout handles URL
fragments). Whether these pages are still linked publicly is **Unknown**.

## Server actions

Every action re-resolves the caller on the server. "Routine" names the `private.*` function that
enforces the rule again.

### Authentication ([`app/admin/actions.ts`](../../app/admin/actions.ts), [`app/auth/reset/actions.ts`](../../app/auth/reset/actions.ts))

| Action                  | Who                   | Notes                                                                                                                                 |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `loginAction`           | Anyone                | `signInWithPassword` through the cookie client. One generic error for an unknown account or a wrong password.                         |
| `requestRecoveryAction` | Anyone                | Needs `AUTH_REDIRECT_ORIGIN`. Sets an `httpOnly` recovery-intent cookie for the PKCE flow. Only email delivery problems are reported. |
| `logoutAction`          | Signed in             | `supabase.auth.signOut()`, then redirect to `/admin/login`                                                                            |
| `resetPasswordAction`   | Live recovery session | Updates the password and ends the recovery session                                                                                    |

### Events ([`app/admin/(protected)/events/`](<../../app/admin/(protected)/events/>))

| Action                                                                                                                                                             | Who                                                | Routine                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveEventAction` (create or edit, cover image, phone requirement)                                                                                                 | Any level in scope                                 | `private.save_event_details`; the cover goes to the event bucket first                                                                                                                                               |
| `lifecycleEventAction` `flag_review`, `unflag_review`, `publish_event`, `reopen_event` (also `publish_event`), `hold_event_full`, `archive_event`, `restore_event` | Any level in scope                                 | Matching routine. Each locks the event row, checks `expected_revision` and writes one audit row.                                                                                                                     |
| `lifecycleEventAction` `approve_event`, `reject_review` (note ≤ 200 characters)                                                                                    | Board, Technical; never the current review subject | `private.approve_event`, `private.reject_review` (`can_review_event`; self-approval is refused by the routine and by the `events_no_self_approval` CHECK)                                                            |
| `promoteWaitlistAction`                                                                                                                                            | Any level in scope                                 | `private.promote_waitlist` (FIFO, contact confirmation attested)                                                                                                                                                     |
| `attendanceListAction`, `checkinAction` (`read`, `open`, `rotate`, `close`), `manualAttendanceAction`                                                              | Any level in scope                                 | `private.list_event_attendance`, `private.manage_event_checkin`, `private.record_manual_attendance`. Manual reasons: `qr_unavailable`, `no_account`, `organizer_verified`; undo: `recorded_in_error`, `not_present`. |

### Membership ([`app/admin/(protected)/membership/`](<../../app/admin/(protected)/membership/>))

| Action                                                                          | Who                  | Routine                                                                                                                                        |
| ------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewMembershipAction` (`verify`, `approve`, `reject`, note ≤ 500 characters) | Membership reviewers | `private.review_membership_application`; approval follows the recorded policy                                                                  |
| `activateMembershipAction`                                                      | Membership reviewers | `private.activate_membership`; when it answers `NEEDS_INVITATION`, the action invites the applicant through the Auth Admin API and tries again |
| `setMembershipPolicyAction`                                                     | Technical            | `private.set_membership_approval_policy` (`two_step`, `single_step`, `unset`)                                                                  |
| `decideCorrectionAction`                                                        | Membership reviewers | `private.decide_profile_change`                                                                                                                |

After a decision, `after()` runs `processMembershipStorageDeletions()` to delete queued ID-card
objects.

### Projects ([`app/admin/(protected)/projects/actions.ts`](<../../app/admin/(protected)/projects/actions.ts>))

| Action          | Who                                                                                           | Routine                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewProject` | Society Affairs Committee Manager, Board, Technical; never the author or a linked team member | `private.project_write` with `start_review`, `approve` (needs the no-conflict attestation), `reject` and `request_changes` (both need feedback), `publish`, `unpublish` |

### Access and accounts ([`app/admin/(protected)/access/`](<../../app/admin/(protected)/access/>))

| Action                                               | Who                                                                                                                              | Routine and Auth calls                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `changeAccessAction` (`grant`, `reassign`, `revoke`) | Technical: every level. Board: `COMMITTEE_MANAGER` only, never on Board or Technical accounts                                    | `private.change_administrative_access` or `private.change_technical_access`                                                       |
| `replaceManagerAction`                               | Board, Technical                                                                                                                 | `private.replace_committee_manager` (atomic revoke and grant, two correlated audit rows)                                          |
| `createUserAction`                                   | Technical: any level, invite or password. Board: no role or Committee Manager, by invitation only, within its visible committees | Auth Admin API (`inviteAuthUser`, `createAuthUserWith…`), then the access routine; audited via `private.record_auth_admin_action` |
| `resendInvitationAction`                             | Board, Technical                                                                                                                 | Auth Admin API; audited                                                                                                           |
| `sendResetEmailAction`, `setTemporaryPasswordAction` | Technical                                                                                                                        | Auth Admin API; audited; never on one's own account for the temporary password                                                    |
| `getUserHistoryAction`                               | Board, Technical                                                                                                                 | `private.list_user_audit`                                                                                                         |

### Administration ([`app/admin/(protected)/administration/`](<../../app/admin/(protected)/administration/>))

| Action                                                                                    | Who                              | Routine                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCommitteeAction`, `updateCommitteeAction`, `archiveCommitteeAction`                | Board, Technical                 | `private.admin_create_committee`, `admin_update_committee`, `admin_set_committee_archived`                                                                                                            |
| `rosterAction`, `searchMembersAction`                                                     | Board, Technical                 | `private.admin_change_committee_member`, `admin_list_members`                                                                                                                                         |
| `accessSuspensionAction`                                                                  | Board (managers only), Technical | `private.set_access_suspension`                                                                                                                                                                       |
| `previewDeletionAction`, `deletePermanentlyAction` for kinds `event`, `project`, `member` | Board, Technical                 | `private.preview_*_deletion`, `delete_event_permanently`, `delete_project_permanently`, `delete_member_record`. Typed confirmation; members also require the actor's password (`confirmOwnPassword`). |
| `previewDeletionAction`, `deletePermanentlyAction` for kind `account`                     | Technical                        | `private.preview_member_deletion` and `private.erase_account`, then `deleteAuthUser` and `private.complete_account_erasure`                                                                           |
| `retryErasureAction`                                                                      | Technical                        | Retries the Auth deletion and completion for a pending erasure                                                                                                                                        |

### Core's public registration ([`app/(marketing)/actions.ts`](<../../app/(marketing)/actions.ts>))

`registerForEventAction` takes the same fields as the public API, uses the client IP from
`x-vercel-forwarded-for` (or `127.0.0.1` in development) and calls `lib/registrations`
`registerForEvent`, which calls the same database routine.

## Session and cookie notes

- Dashboard sessions are Supabase SSR cookies (`@supabase/ssr`). The website never shares them:
  member sessions live in the website visitor's browser storage, on a different origin.
- The recovery-intent cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
- Revoking access takes effect on the next request; no sign-out is needed. Core cannot invalidate
  another user's Supabase session (ADR 0014).
