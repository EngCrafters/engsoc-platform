# Local member-profile workflow

`npm run test:profile-flow` drives the website and Core together on the event-flow harness
(`tests/event-flow/setup.ts`): a fresh local database, real restricted-role routines, and the
synthetic Auth and S3 adapters. Its prerequisites are the same as `tests/event-flow`.

The browser:

1. registers with a synthetic ID card, is refused sign-in until it confirms its email, and then
   uses the link from the synthetic inbox;
2. sees the pending account menu without member privileges;
3. is approved, then sees its avatar and opens My profile;
4. edits its details, with validation and cancel;
5. uploads a photo, and the navbar follows;
6. asks for a correction to a verified field, which a reviewer approves on the dashboard;
7. refreshes and finds everything persisted, then signs out back to the original navbar;
8. checks the Community menu in both states, the API's authorization, and Arabic at phone width.
