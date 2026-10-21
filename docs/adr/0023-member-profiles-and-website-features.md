# ADR 0023: Member profiles and the website's feature switches

Accepted for local implementation by the owner's October 21, 2026 request, "Smart Navbar &
Complete Member Profile". Migration `0031_member_profiles` is forward-only and unapplied to
hosted environments. Applying it, and creating the private member-photo bucket, needs the owner's
approval.

## One account, one profile

The website's navbar and `/profile` read Supabase Auth's own session. Core still decides who is a
member: signing in alone grants nothing.

- **Members** see their profile.
- **Applicants** see only where their application stands.
- **Any other account** is offered the membership form.

No second user system exists. `public.members` gains a photo key, interests and `updated_at`. All
reads and writes go through SECURITY DEFINER routines owned by `uc02_routine_owner`. `app_runtime`
can only execute them, and browser roles have no access.

Every member route takes the member's identity from the verified bearer token and nothing else,
so members can read and change only their own profile.

## What a member can change

| Field                                             | How it changes                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Phone, academic year, discipline, interests (≤ 4) | `PATCH /v1/me/profile`, validated in the route and again in the routine, audited by field name |
| Photo                                             | `PUT`/`DELETE /v1/me/profile/photo`                                                            |
| Full name, student ID                             | `POST /v1/me/profile/changes`: a request a membership reviewer decides                         |
| Sign-in email, password                           | Supabase Auth's confirmation emails only                                                       |

Name and student ID were checked against the SQU ID card (ADR 0018), so a member never changes
them directly.

- **Requests.** Each correction is a request in `private.member_change_requests`, one pending per
  field.
- **Reviewers.** Society Affairs, Board and Technical, the 0025 membership reviewers, approve or
  reject it on the dashboard's membership page. They never decide their own request.
- **Approval** updates the member row.
- **Audit.** Each step is audited (`member.change_requested`, `member.change_decided`).

The sign-in email is Supabase Auth's: changing it needs confirmation from both addresses.
`members.email` follows it only when it becomes a confirmed `squ.edu.om` address. That sync is
audited as `member.email_synced`. A non-SQU sign-in address never replaces the verified
university email.

## Photos

The browser sends raw JPEG or PNG bytes, at most 3 MiB. Core processes them before storing:

1. **Check.** It checks the file signature.
2. **Re-encode.** It decodes the image with a pixel limit, applies EXIF rotation and drops all
   metadata. It then crops to a 512×512 JPEG.
3. **Store.** It stores the result as `member-photos/<uuid>.jpg` in a private bucket,
   `SUPABASE_S3_MEMBER_PHOTO_BUCKET`. The configuration refuses the ID-card, event and project
   buckets.

The previous object is deleted after the new key is saved. If saving fails, the new object is
deleted instead. Photos are served only to their owner, with `no-store`. No public photo URL
exists.

## Feature switches

`ESWebsite/config/site-features.json` is the single developer-controlled switchboard. It holds:

- whether the selected pages are open or Coming Soon;
- whether the profile offers photo uploads and editing.

It is static and built in, and the dashboard cannot change it. It amends ADR 0021: the page flags
move out of `content/site.ts`, which now reads them from this file.

Core keeps its own matching switches, `MEMBER_PHOTO_UPLOADS` and `MEMBER_PROFILE_EDITING`.
Setting either to `disabled` turns the feature off; the default is on. Core enforces them on every
request, so a disabled upload leaves no open upload endpoint. `GET /v1/me/profile` reports them.

The website shows a control only when both its own setting and Core's allow it. Removing a photo
stays available, so members can always withdraw their image. The switches never replace
authorization.

## Not included

- No automatic expiry or deletion of applications or profiles.
- No public member directory: Members and Network stay Coming Soon.
- No photo in any public response.
