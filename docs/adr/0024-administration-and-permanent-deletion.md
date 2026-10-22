# ADR 0024: Administration section, committee management and permanent deletion

Accepted for local implementation by the owner's October 22, 2026 request, "Advanced
Administration & Management System". Migration `0032_administration` is forward-only and
unapplied to hosted environments; applying it needs the owner's approval.

This ADR amends ADR 0012 (Board Administration gains committee-scoped administration), ADR 0013
(Board may invite committee managers) and ADR 0014 (account deletion becomes a supported,
audited operation instead of exceptional maintenance). Everything else in those ADRs stands.

## Permission matrix

Every rule below is enforced in the database routines; the dashboard only mirrors it.

| Capability                                                      | Technical | Board Administration                        | Committee Manager |
| --------------------------------------------------------------- | --------- | ------------------------------------------- | ----------------- |
| Administration section (overview, committees, members)          | Yes       | Yes                                         | No                |
| Create, edit, archive and restore committees                    | Yes       | Yes                                         | No                |
| Committee roster and responsibilities                           | Yes       | Yes                                         | No                |
| Assign, reassign, replace, suspend, reactivate, revoke managers | Yes       | Yes, never on Board or Technical accounts   | No                |
| Grant or revoke Board Administration                            | Yes       | No                                          | No                |
| Grant, revoke, suspend or reactivate Technical                  | Yes       | No                                          | No                |
| View accounts and access history                                | Yes       | Yes                                         | No                |
| Invite an account                                               | Any role  | Committee Manager or no role, by email only | No                |
| Password reset email, temporary password                        | Yes       | No                                          | No                |
| Delete an event or project permanently                          | Yes       | Yes                                         | No                |
| Delete a membership record                                      | Yes       | Yes                                         | No                |
| Delete a sign-in account completely                             | Yes       | No                                          | No                |

Nobody changes their own access or deletes their own records. The last active Technical account
cannot be revoked or suspended. Grants, suspensions and reactivations share ADR 0014's ownership
lock, so concurrent changes serialize and revocation takes effect on the next request.

## Committees

- **Identity.** A committee's slug is its stable identifier: set at creation, never edited.
  Names and descriptions are editable; names stay unique ignoring case.
- **No deletion.** Committees are archived, never deleted, so events, projects, grants and
  audit keep their committee.
- **Archived.** An archived committee keeps all its records and remains operable for them. It
  accepts no new events, manager grants, reactivations or roster changes. Archiving requires no
  active managers and no upcoming live events. Society Affairs and the Technical Team, which
  other workflows name by slug, cannot be archived.
- **Roster.** `private.committee_members` lists the society members who belong to a committee,
  each with an optional responsibility. Being on a roster grants nothing.
- **Leadership.** Leadership is the committee's manager access. Transfer uses ADR 0014's atomic
  replacement.

## Access suspension

A suspension is a revocation that remembers it is temporary
(`administrative_access.revocation_kind = 'suspended'`). It ends access immediately, through the
same `revoked_at` predicate as every other check. Reactivation restores exactly the former role
and committee, and is refused for an ordinary revocation or an archived committee. Earlier
revocations are read as ordinary revocations; no existing row is rewritten.

## Permanent deletion

Archive and unpublish stay separate, reversible actions. Permanent deletion follows the rules
below.

- **Preview and confirmation.** It always shows a preview of everything affected and every
  blocker. It requires typing the record's name, title or email; member and account deletion
  also re-enter the administrator's password.
- **Events.** Only archived events or never-published drafts can be deleted. The event, its
  registrations (with their personal data) and check-in sessions are deleted. Certificates
  block deletion.
- **Projects.** A project must be unpublished first. Its history and images go with it.
- **Membership record.** This removes the member row, applications and ID cards, correction
  requests, roster places, the photo and rate-limit rows. Registrations are anonymized, not
  deleted, so event counts and attendance totals stay true. The sign-in account remains and can
  apply again.
- **Account (Technical only).** This does the above, then removes the account's revoked grant
  row and pseudonymizes its audit rows, then deletes the Supabase Auth identity through the
  Admin API. The database part is one transaction. The Auth deletion follows it and is
  recorded in `private.account_erasures` until it is confirmed, so a failure is retried, never
  lost. An account with active access must be revoked first. An account whose identity anchors
  decisions about other people is kept for accountability: grants, reviews, approvals, project
  decisions or policy changes.
- **Blockers.** Projects, legacy archive or mentorship rows, and certificates block deletion
  with an explanation. Nothing unrelated is ever cascaded.
- **Files.** Storage files go through the existing deletion queue. The database removes the
  reference in the same transaction and the queue deletes the object, retrying until it is gone.

## Audit

Audit rows are never deleted.

- **Deletions.** The foreign keys from audit rows to events and registrations are dropped. Their
  IDs remain as non-personal references, so the history of a deleted event stays readable.
- **Erasure.** Erasing an account turns its actor rows into the `erased` placeholder. Its ID is
  nulled wherever audit JSON names it, and free-text notes about it are removed.
- **Guard.** A trigger allows exactly these changes and refuses any other update.
- **New actions.** Each new action is audited: committee changes, roster changes, suspensions,
  reactivations and deletions.

## Not included

- No membership suspension: no approved policy defines it (owner decision pending).
- No automatic expiry or deletion of applications or members, after any period.
- No deletion of committees, applications still under review, or audit rows.
