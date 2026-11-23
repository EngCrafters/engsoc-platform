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
   - it calls `private.get_dashboard_access(user)` once, through `app_runtime`: every permission
     the person holds with its scope (society-wide or a list of committees), their personal level,
     their active appointments and the live committees (ADR 0027). The answer is cached for the
     request only (React `cache`), so a revocation applies on the next request.
3. The outcome:
   - not signed in: redirect to `/admin/login?next=/admin/events`;
   - signed in without any permission: the `NoAccessState` page ("You're signed in, but this
     account does not currently have administrative access.");
   - otherwise the shell renders with the navigation those permissions open.
4. Each page and server action checks the permission it needs again (`requirePermission`,
   `requireAnyPermission` or `can` from [`lib/auth/permissions.ts`](../../lib/auth/permissions.ts)).
   It then calls a `private.*` routine with the verified user ID as `p_actor`, and **the routine
   re-checks the permission, for the record's committee where it applies, against live data**. UI
   visibility is never the security boundary.

## Pages

"Holders of X" means people with permission X in any scope; scoped permissions then apply per
committee.

| Path                                                             | Who can open it                                                                              | Enforcement                                                                                                     | What it does                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/login`                                                   | Anyone                                                                                       | none (redirect target)                                                                                          | Email and password sign-in (`loginAction`); `?next=` restricted to safe dashboard paths                                                                                                                                                                                                       |
| `/admin/recovery`                                                | Anyone                                                                                       | none                                                                                                            | Requests a recovery email to `AUTH_REDIRECT_ORIGIN/auth/callback`; the same answer for every address                                                                                                                                                                                          |
| `/auth/reset`                                                    | Holder of a live recovery session                                                            | The page refuses without one                                                                                    | Choose and confirm a new password (`resetPasswordAction`)                                                                                                                                                                                                                                     |
| `/admin`                                                         | Signed in                                                                                    | Redirect                                                                                                        | Redirects to `/admin/events`                                                                                                                                                                                                                                                                  |
| `/admin/events`                                                  | Holders of `events.view`                                                                     | `list_admin_events`, `count_admin_events` list only committees in scope                                         | Event list with status filters and cursor paging; committee filter when more than one committee is in scope                                                                                                                                                                                   |
| `/admin/events/new`                                              | Holders of `events.create`                                                                   | `save_event_details` → `create_event` checks the committee                                                      | Create an event in a committee where the person holds `events.create`                                                                                                                                                                                                                         |
| `/admin/events/[id]`                                             | `events.view` for the event's committee                                                      | `get_admin_event` returns nothing out of scope, so 404; each lifecycle routine names its permission             | Details, editing (`events.edit`), lifecycle (`events.publish`). Review controls need `events.approve`, permanent deletion `events.delete`, both for the event's committee                                                                                                                     |
| `/admin/events/[id]/registrations` and `attendance`              | `registrations.view` for the event's committee                                               | `list_admin_registrations`, `list_event_attendance`; promotion and check-in need `registrations.manage`         | Registration list and counts, waitlist promotion, CSV export; check-in, QR code, manual attendance                                                                                                                                                                                            |
| `/admin/membership`, `/admin/membership/[id]`                    | Holders of `membership.view`                                                                 | `get_membership_review_overview`, `list_membership_applications`; decisions need `membership.review`            | **Applications**: list, filters, history, legacy ID card viewer; verify, approve, reject, activate (`membership.review`); final two-step approval (`membership.final_approval`); the approval policy (`settings.membership_policy`); corrections                                              |
| `/admin/membership/verifications` and `[id]`                     | Holders of `squ.view`; holders of `settings.verification` see the settings only              | `list_squ_verifications`, `get_squ_verification`; decisions need `squ.review`                                   | **SQU verification**: search, filters, pages of 25; evidence (audited); verify, reject, revoke. The settings card is editable with `settings.verification`                                                                                                                                    |
| `/admin/membership/leadership` and `[id]`                        | Holders of `leadership.view`; holders of `settings.verification` see the switch and settings | `list_leadership_requests` lists requests whose committee is in scope; decisions need `leadership.review` there | **Leadership**: the **Leadership requests** switch and the **Verification and leadership settings** card (both `settings.verification`), then the queue. Detail: approve or reject (`leadership.review` for the request's committee), revoke                                                  |
| `/admin/projects`, `/admin/projects/[id]`                        | Holders of `projects.view`                                                                   | `project_read(…, review=true)`; `project_write` needs `projects.review` or `projects.publish`                   | Review queue; start review, approve with attestation, reject, request changes, publish, unpublish; deletion (`projects.delete`)                                                                                                                                                               |
| `/admin/communications/email` and `[id]`                         | Holders of `email.send`                                                                      | Every `private.email_*` routine checks `email.send`                                                             | **Email Centre** ([ADR 0028](../adr/0028-email-centre.md)): drafts, templates, audience filters with a server-side preview, bilingual message, rendered preview, test to oneself, confirmation with the exact count, background sending with progress and failures                            |
| `/admin/account`                                                 | Anyone with a permission                                                                     | Layout                                                                                                          | Where the person's access comes from and every permission they hold, with its scope                                                                                                                                                                                                           |
| `/admin/administration`                                          | Holders of `committees.view`                                                                 | `admin_overview`                                                                                                | Overview counts, area links filtered by permission, your access summary, pending account erasures (`accounts.erase`)                                                                                                                                                                          |
| `/admin/administration/committees` and `[id]`                    | `committees.view`, or `teams.manage` / `leadership.assign` for the committee                 | `admin_list_committees`, `admin_get_committee`, `admin_list_committee_teams` (`can_view_committee`)             | Committee catalog and detail. Editing and archiving: `committees.manage`; managers: `accounts.view` / `accounts.manage`; teams: `teams.manage` for the committee; appointing: `leadership.assign`; changing and revoking leaders: `leadership.review`                                         |
| `/admin/administration/members` and `[id]`                       | Holders of `members.view`                                                                    | `admin_list_members`, `admin_get_member`                                                                        | Member directory and details; permanent deletion (record: `members.delete`; account: `accounts.erase`)                                                                                                                                                                                        |
| `/admin/administration/permissions` and `[committee\|team]/[id]` | Holders of `permissions.manage`                                                              | `list_permission_groups`, `get_permission_group`, `set_group_permissions`                                       | **Permissions** (ADR 0027): every committee and team with its permissions; per group, grouped checkboxes with scopes, Grant full access, Remove access, preview of affected leaders, confirmation for full access and permission management, history; the fixed personal levels for reference |
| `/admin/access`                                                  | Holders of `accounts.view`                                                                   | `list_administrative_access`, `list_auth_directory`; each change checks its permission                          | Accounts and access: directory, invitations and grants (`accounts.manage`), Board and Technical access (`accounts.admin_levels`), password tools (`accounts.credentials`), account deletion (`accounts.erase`), history                                                                       |
| `/dev/design-system`                                             | Development only                                                                             | 404 when `NODE_ENV=production`                                                                                  | Component gallery                                                                                                                                                                                                                                                                             |

### Navigation visibility

[`components/admin/admin-navigation.ts`](../../components/admin/admin-navigation.ts) (`dashboardNav`)
decides on the server which entries the person's permissions open, and the sidebar shows only
those:

- **Events** (`events.view`) and **Create event** (`events.create`);
- **Projects Management** (`projects.view`);
- a **Membership** group with **Applications** (`membership.view`), **SQU verification**
  (`squ.view` or `settings.verification`) and **Leadership** (`leadership.view` or
  `settings.verification`), each with its own "awaiting a decision" badge when the overview
  answers. If the membership routines are missing, holders of any of these see a setup notice;
- **Communications → Email Centre** (`email.send`);
- **Society administration**: Overview (`committees.view`), Committees (`committees.view`, or team
  or appointment permissions), Members (`members.view`), Accounts & access (`accounts.view`) and
  Permissions (`permissions.manage`).

The footer shows where the access comes from (a level, and positions whose groups grant
permissions) and the events scope ("All Committees", one committee, or how many). The pages and
routines enforce the same rules independently.

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

| Action                                                                                                                                                             | Who                                                                                                          | Routine                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveEventAction` (create or edit, cover image, phone requirement)                                                                                                 | `events.create` (new) or `events.edit` for the event's committee                                             | `private.save_event_details`; the cover goes to the event bucket first                                                                                                                                               |
| `lifecycleEventAction` `flag_review`, `unflag_review`, `publish_event`, `reopen_event` (also `publish_event`), `hold_event_full`, `archive_event`, `restore_event` | `events.edit` (flag) or `events.publish` (publish, hold, reopen, archive, restore) for the event's committee | Matching routine. Each locks the event row, checks `expected_revision` and writes one audit row.                                                                                                                     |
| `lifecycleEventAction` `approve_event`, `reject_review` (note ≤ 200 characters)                                                                                    | `events.approve` for the event's committee; never the current review subject                                 | `private.approve_event`, `private.reject_review` (`can_review_event`; self-approval is refused by the routine and by the `events_no_self_approval` CHECK)                                                            |
| `promoteWaitlistAction`                                                                                                                                            | `registrations.manage` for the event's committee                                                             | `private.promote_waitlist` (FIFO, contact confirmation attested)                                                                                                                                                     |
| `attendanceListAction`, `checkinAction` (`read`, `open`, `rotate`, `close`), `manualAttendanceAction`                                                              | `registrations.view` (list) or `registrations.manage` (check-in, manual) for the event's committee           | `private.list_event_attendance`, `private.manage_event_checkin`, `private.record_manual_attendance`. Manual reasons: `qr_unavailable`, `no_account`, `organizer_verified`; undo: `recorded_in_error`, `not_present`. |

### Membership ([`app/admin/(protected)/membership/`](<../../app/admin/(protected)/membership/>))

| Action                                                                          | Who                                                                           | Routine                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewMembershipAction` (`verify`, `approve`, `reject`, note ≤ 500 characters) | `membership.review`; final two-step approval also `membership.final_approval` | `private.review_membership_application`; approval follows the recorded policy                                                                  |
| `activateMembershipAction`                                                      | `membership.review`                                                           | `private.activate_membership`; when it answers `NEEDS_INVITATION`, the action invites the applicant through the Auth Admin API and tries again |
| `setMembershipPolicyAction`                                                     | `settings.membership_policy`                                                  | `private.set_membership_approval_policy` (`two_step`, `single_step`, `unset`)                                                                  |
| `decideCorrectionAction`                                                        | `membership.review`                                                           | `private.decide_profile_change`                                                                                                                |

After a decision, `after()` runs `processMembershipStorageDeletions()` to delete queued ID-card
objects.

### Projects ([`app/admin/(protected)/projects/actions.ts`](<../../app/admin/(protected)/projects/actions.ts>))

| Action          | Who                                                                                                      | Routine                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewProject` | `projects.review` (`projects.publish` to publish or unpublish); never the author or a linked team member | `private.project_write` with `start_review`, `approve` (needs the no-conflict attestation), `reject` and `request_changes` (both need feedback), `publish`, `unpublish` |

### Access and accounts ([`app/admin/(protected)/access/`](<../../app/admin/(protected)/access/>))

| Action                                               | Who                                                                                                                                                             | Routine and Auth calls                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `changeAccessAction` (`grant`, `reassign`, `revoke`) | `accounts.admin_levels`: every level. `accounts.manage`: `COMMITTEE_MANAGER` only, never on Board or Technical accounts                                         | `private.change_administrative_access` or `private.change_technical_access`                                                       |
| `replaceManagerAction`                               | `accounts.manage` or `accounts.admin_levels`                                                                                                                    | `private.replace_committee_manager` (atomic revoke and grant, two correlated audit rows)                                          |
| `createUserAction`                                   | `accounts.manage`: no role or Committee Manager, by invitation. `accounts.admin_levels`: any level. Creating with or without a password: `accounts.credentials` | Auth Admin API (`inviteAuthUser`, `createAuthUserWith…`), then the access routine; audited via `private.record_auth_admin_action` |
| `resendInvitationAction`                             | `accounts.manage` or `accounts.admin_levels`                                                                                                                    | Auth Admin API; audited                                                                                                           |
| `sendResetEmailAction`, `setTemporaryPasswordAction` | `accounts.credentials`                                                                                                                                          | Auth Admin API; audited; never on one's own account for the temporary password                                                    |
| `getUserHistoryAction`                               | `accounts.view`                                                                                                                                                 | `private.list_user_audit`                                                                                                         |

### Administration ([`app/admin/(protected)/administration/`](<../../app/admin/(protected)/administration/>))

| Action                                                                                    | Who                                                                              | Routine                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCommitteeAction`, `updateCommitteeAction`, `archiveCommitteeAction`                | `committees.manage`                                                              | `private.admin_create_committee`, `admin_update_committee`, `admin_set_committee_archived`                                                                                                            |
| `rosterAction`, `searchMembersAction`                                                     | `committees.manage` (search: also `leadership.assign`)                           | `private.admin_change_committee_member`, `admin_list_members`                                                                                                                                         |
| `accessSuspensionAction`                                                                  | `accounts.manage` (managers only) or `accounts.admin_levels`                     | `private.set_access_suspension`                                                                                                                                                                       |
| `previewDeletionAction`, `deletePermanentlyAction` for kinds `event`, `project`, `member` | `events.delete` (for the event's committee), `projects.delete`, `members.delete` | `private.preview_*_deletion`, `delete_event_permanently`, `delete_project_permanently`, `delete_member_record`. Typed confirmation; members also require the actor's password (`confirmOwnPassword`). |
| `previewDeletionAction`, `deletePermanentlyAction` for kind `account`                     | `accounts.erase`                                                                 | `private.preview_member_deletion` and `private.erase_account`, then `deleteAuthUser` and `private.complete_account_erasure`                                                                           |
| `retryErasureAction`                                                                      | `accounts.erase`                                                                 | Retries the Auth deletion and completion for a pending erasure                                                                                                                                        |

### Committee teams and leaders ([`committees/[id]/team-actions.ts`](<../../app/admin/(protected)/administration/committees/[id]/team-actions.ts>))

| Action                                                   | Who                                   | Routine                                                                                |
| -------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `saveTeamAction`, `teamStatusAction`, `deleteTeamAction` | `teams.manage` for the committee      | `admin_create_team`, `admin_update_team`, `admin_set_team_status`, `admin_delete_team` |
| `moveTeamAction`                                         | `teams.manage` for both committees    | `admin_move_team`                                                                      |
| `assignLeaderAction`                                     | `leadership.assign` for the committee | `assign_leadership`                                                                    |
| `changeLeaderPositionAction`                             | `leadership.review` for the committee | `update_leadership_appointment`                                                        |

### Verification and leadership settings ([`membership/verification-actions.ts`](<../../app/admin/(protected)/membership/verification-actions.ts>))

| Action                                              | Who                                            | Routine                                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveVerificationSettingsAction`                    | `settings.verification`                        | `set_verification_settings` (6 arguments): a retention period that makes stored evidence eligible for deletion answers `RETENTION_CONFIRMATION_REQUIRED` with the count until confirmed |
| `setPositionLimitAction`                            | `settings.verification`                        | `set_position_limit(actor, position, 'team' \| 'committee', max)`                                                                                                                       |
| `setLeadershipRequestsOpenAction`                   | `settings.verification`                        | `set_leadership_requests_open`                                                                                                                                                          |
| `decideSquAction`, `revokeSquAction`                | `squ.review`                                   | `decide_squ_verification`, `revoke_squ_verification`                                                                                                                                    |
| `decideLeadershipAction`, `revokeAppointmentAction` | `leadership.review` for the record's committee | `decide_leadership_request`, `revoke_leadership_appointment`                                                                                                                            |

### Permissions ([`administration/permissions/actions.ts`](<../../app/admin/(protected)/administration/permissions/actions.ts>))

| Action                       | Who                  | Routine                                                                                                                                                                                 |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveGroupPermissionsAction` | `permissions.manage` | `set_group_permissions`: `SELF_CHANGE`, `STALE_REVISION`, `CONFIRMATION_REQUIRED` (full access or `permissions.manage` changes), `LAST_RECOVERY_ACCOUNT`; audited `permissions.changed` |

### Email Centre ([`communications/email/actions.ts`](<../../app/admin/(protected)/communications/email/actions.ts>))

Every action needs `email.send`; the routines check it again.

| Action                                                              | Routine and notes                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDraftAction`, `saveDraftAction`                              | `email_save_campaign` (drafts only, revision-guarded, audience validated)                                                                    |
| `previewAudienceAction`, `searchMembersAction`, `memberNamesAction` | `email_audience_preview` (count and one page of 25, searchable), `email_search_members`, `email_member_names`                                |
| `renderPreviewAction`                                               | `lib/email/format.ts` only: the same renderer that sends                                                                                     |
| `sendTestAction`                                                    | Sends to the actor's own sign-in address through the configured transport, then `email_record_test`. Refused while sending is not configured |
| `queueCampaignAction`                                               | `email_queue_campaign` with the confirmed count (`AUDIENCE_CHANGED` otherwise). Refused while sending is not configured                      |
| `runBatchAction`                                                    | One bounded batch (`dispatchEmailBatch`), then `email_get_campaign` for the progress view                                                    |
| `cancelCampaignAction`                                              | `email_cancel_campaign`                                                                                                                      |
| `saveTemplateAction`, `archiveTemplateAction`                       | `email_save_template`, `email_archive_template`                                                                                              |

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
