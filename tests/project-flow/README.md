# Projects browser workflow

`npm run test:project-flow` reuses the isolated two-app harness and synthetic
local Auth/S3 adapters from the event suite. All business decisions run through
the real restricted `app_runtime` PostgreSQL routines. A fresh loopback
`TEST_DATABASE_URL` with `uc02_test` in its name is mandatory. Replaying migrations
in this disposable local environment was explicitly approved by the owner.
The suite never connects to hosted Supabase or reuses real accounts/data.

For release verification, build both apps with `ESSQU_EVENT_FLOW=true` (isolated
`.next-event-flow` output), then set `EVENT_FLOW_PRODUCTION=true` when running
the suite. Core's build must use the harness's public Auth URL
`http://127.0.0.1:3602` and synthetic anon key from `tests/event-flow/setup.ts`.
The harness supplies all runtime settings. This uses the actual production
bundles and avoids development hot-reload interference during navigation.

The workflow covers member UI creation/media/submission, scoped committee review,
changes requested and resubmission, approval vs explicit publication, original
public cards/detail/media, privacy of later drafts and rejected submissions,
unpublishing, wrong-committee denial, and Arabic/mobile layout. Static Coming Soon
flags are verified in ESWebsite's unit suite; they have no Core API/database state.
