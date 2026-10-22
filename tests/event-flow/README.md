# Local event workflow

`npm run test:event-flow` exercises both applications with a fresh local
PostgreSQL database and real restricted-role routines. Set `TEST_DATABASE_URL`
to a fresh loopback database with `uc02_test` in its name; the shared harness
refuses hosted targets. It replays migrations into that disposable database.

Install Playwright Chromium first (or set `EVENT_FLOW_BROWSER_CHANNEL=chrome`
for installed Chrome). Ports 3600–3602 must be free. Both repositories need
installed dependencies. Test build output stays under `.next-event-flow` so an
existing dev server can keep running. Test-only Auth and S3 HTTP adapters use
synthetic accounts and images; this is not hosted Supabase verification.

The browser creates/edits/publishes an image/linked-description/phone-required
event, registers verified profiles and a waitlist, decodes the actual QR,
checks safe login return and explicit attendance, verifies the persisted phone,
attendance/audit, scoped dashboard/CSV, foreign-manager denial, Arabic and mobile.
No test code or adapters are loaded by application routes.
