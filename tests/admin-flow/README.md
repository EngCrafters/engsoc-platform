# Local administration workflow

`npm run test:admin-flow` drives the Core dashboard on the event-flow harness
(`tests/event-flow/setup.ts`): a fresh local database, real restricted-role routines, and synthetic
Auth (including the Admin API's invite and delete-user) and S3. Prerequisites are those of
`tests/event-flow`.

It checks three things in the browser:

- Committee managers cannot reach the Administration section or the accounts page.
- Board Administration runs a committee end to end:
  - creates and edits it;
  - adds a roster member;
  - assigns a manager, then suspends, reactivates and revokes them;
  - has archiving refused while a manager is active, then archives and restores the committee.

  It also confirms Board cannot touch Technical accounts, credentials or account deletion.

- The Technical Team deletes permanently:
  - a live event is refused with its reason;
  - an archived event is deleted, with its registrations and its cover file from storage;
  - a project is deleted;
  - a membership record is deleted after a wrong password is refused;
  - a whole account is erased, including its Auth identity.
