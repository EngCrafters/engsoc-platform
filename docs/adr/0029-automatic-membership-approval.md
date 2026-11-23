# 0029 — Automatic membership approval

Status: accepted (owner direction, 2026-11-22). Adds a third value to ADR 0017's approval policy and
makes it the active one; ADR 0017's review flow, ADR 0019's account rules and ADR 0027's
permissions stay as they are.
Related: ADR 0017 (applications and review), ADR 0019 (member accounts and sign-in), ADR 0025
(expanded membership), ADR 0027 (permissions), migration `0037_automatic_membership_approval`

## Context

Every registration on the website waited in `/admin/membership` until a reviewer approved it. The
owner asked for registration to make the person an approved member at once, with no manual
approval, while keeping validation, duplicate prevention, authentication security, RLS and the
existing member management.

Two facts shape how "at once" can work safely:

- A member record is keyed by the person's Supabase Auth identity (`members.id` is the Auth user
  ID), and the website creates that identity only after Core accepts the registration
  (ADR 0019: Core never receives the password).
- Anyone can type someone else's email address into a form. ADR 0019 therefore attaches an
  application to an Auth identity only once that identity's email is **confirmed**. Skipping that
  check would let a stranger create a membership in another person's name and mailbox.

## Decision

### A third policy: `automatic`

`private.membership_settings.approval_policy` accepts `automatic` besides `two_step` and
`single_step`. Under `automatic`, `private.submit_membership_application_v2` stores a valid
registration directly as `approved`, in the same transaction:

- `decided_at` is the submission time, `decided_by` is empty, and the new column
  `auto_approved` is true. A table constraint keeps these consistent: an automatic decision is
  always an approval with no reviewer, and every reviewer decision still names its reviewer.
- Audit: `membership.submitted`, then `membership.approved` with `policy: "automatic"` and no
  reviewer. Neither row holds personal data.
- Validation, the five-per-hour address limit and the duplicate checks (`ALREADY_APPLIED`,
  `ALREADY_MEMBER`, the open-application unique index) run first and are unchanged. A refused
  registration stores nothing.
- The routine still accepts no role, committee, status or reviewer from the caller, and writes
  nothing to `administrative_access`, committee membership, leadership or permissions.

The response tells the caller what happened: `POST /v1/membership-applications` answers
`201 {data:{status:"approved", statusToken}}` (or `"pending_review"` under the other policies), and
`GET /v1/membership-options` gains `approval: "automatic" | "review"`, which the website uses only
to choose its wording.

### Activation still needs a proven email

The member record is written exactly as before, by `private.membership_complete_activation`:

- when the applicant signs in with a **confirmed** email (`private.get_my_membership`, ADR 0019),
  usually straight from the confirmation link the website's sign-up sends; or
- when a reviewer sends the standard invitation for an approved application whose applicant never
  completed sign-up (`private.activate_membership`).

So registration, sign-up and the confirmation link are the whole path: no reviewer is involved,
and the confirmed sign-in creates the member and opens the profile and member features. Supabase
Auth's "confirm email" setting stays on; this decision does not change any Auth configuration.

### What stays

- `two_step` and `single_step` keep their meaning. The Technical Team (`settings.membership_policy`)
  can switch policies on `/admin/membership`; every change is audited.
- Applications submitted before the switch keep their state. Reviewers approve or reject them;
  under `automatic`, approval is one step, as under `single_step`.
- Member management (`/admin/administration/members`: list, filter, edit, deletion) and every RLS
  policy and grant are unchanged. New members appear there once activated.
- On `/admin/membership` the first tab follows the policy: **Approved** under `automatic` (where new
  registrations arrive, with "Activation pending" until the email is confirmed), **Pending review**
  otherwise. The detail page says "automatically at registration" instead of a reviewer.

### Recording the decision

Migration `0037` sets the policy to `automatic` and writes a `membership.policy_changed` audit row
with actor kind `migration`. On every environment it is applied to, automatic approval is the
active policy from that moment.

## Consequences

- The society no longer checks a registrant's details before membership. Anyone who controls an
  email address can become a member by registering; the details they give (category,
  institution, year) are self-declared. SQU student verification (ADR 0025) remains the separate,
  reviewed check for student status.
- An approved application whose applicant never confirms the email stays "approved, activation
  pending" and keeps blocking a second registration with that email, as an approved application
  always has. The applicant can still confirm later, or a reviewer can send the invitation.
- The consent wording (`2026-11-v2`) still says the details are used "to review my application".
  Changing it needs a new consent version across the website, Core and the database; it is left to
  the owner.
- An older Core (before this change) keeps calling the same routine and reads only `code` and
  `applicationId`, so it keeps working against a migrated database; it reports `pending_review` to
  the website even when the database approved the application.
