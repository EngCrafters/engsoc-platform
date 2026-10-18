# Assertive staging HTTP verification

`scripts/staging-api-http-e2e.mjs` exercises a deployed Core preview through
HTTP using the canonical staging `app_runtime` connection. This is an explicit
live suite, separate from the hermetic default tests. It exits nonzero on an
assertion or cleanup failure; printed output contains check summaries only.

Provision the pinned Core `staging` branch preview against staging project
`wnrdgnmmcdedmilnzzsl`, with migration 0024 applied and host enforcement disabled
for that preview. Verify its deployed `APP_RUNTIME_DATABASE_URL` is the staging
`app_runtime` login. Never run a preview using a superuser runtime. Create two
temporary staging API clients: one holding `events:read`, the other active and
valid with no `events:read` scope. Revoke them after verification.

The exact Core staging alias
`https://engsoc-platform-git-staging-eng-crafters.vercel.app` has an alias-specific
Vercel protection exception so anonymous browser registration and CORS preflight
can reach the product. Other preview aliases retain protection; the Core
application's API key and administrative Auth checks still apply. An anonymous
`GET /v1/events` must return the Core `401` problem, never a Vercel login redirect.
Use this public staging ingress without OIDC for the final product-flow run.

Supply the variables through an in-memory parent process environment (preferred)
and launch:

```powershell
node scripts/staging-api-http-e2e.mjs
```

Required variables:

| Variable                           | Value                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_PROJECT_REF`              | Exactly `wnrdgnmmcdedmilnzzsl`                                                                                               |
| `CORE_HTTP_E2E_URL`                | Exactly `https://engsoc-platform-git-staging-eng-crafters.vercel.app`, without `/v1`                                         |
| `APP_RUNTIME_DATABASE_URL`         | Same staging `app_runtime` URL verified in the preview; used only for target/role validation, never connected by the harness |
| `CORE_HTTP_E2E_READ_KEY`           | Temporary `essq_test_...` events-read token                                                                                  |
| `CORE_HTTP_E2E_NO_SCOPE_KEY`       | Distinct temporary `essq_test_...` valid client lacking events-read scope                                                    |
| `SUPABASE_CLI_PATH`                | Optional absolute Supabase CLI executable path; otherwise `supabase` must be on PATH                                         |
| `CORE_HTTP_E2E_OIDC_TOKEN`         | Optional fresh trusted-source token for protected diagnostic runs; omit for the public staging product-flow run              |
| `CORE_HTTP_E2E_LANDING_OIDC_TOKEN` | Fresh Landing development identity for its protected staging UI; injected only on exact Landing-origin requests              |

The parent can decrypt its local DPAPI state directly into child environment
variables, avoiding a plaintext key file. Obtain the short-lived Core token with
`vercel project token engsoc-platform --json --scope eng-crafters` and capture
the `.token` field privately. Never print it. Protected previews must trust that
token's source project; renew it before a run if necessary.

The CLI must already be authenticated for staging and support
`supabase db query --linked --project-ref ... --file ... --output json`. The
installed CLI requires `--linked` to select its Management API transport;
the harness always supplies the fixed explicit staging `--project-ref` alongside
it, overriding the checkout link. It checks CLI help before using these flags.
It never uses migrations, schema changes, an implicit database target, or
production fixture writes. `SUPABASE_CLI_PATH` may point to a JavaScript CLI
entry file, which the harness invokes with its current Node runtime.
Fixture SQL is held in a temporary folder and removed on completion. Raw tokens
are never put in SQL files or CLI arguments. CLI diagnostics and raw assertion
values are suppressed to keep credentials and attendee identifiers out of logs.

The target gate rejects production, non-HTTPS or non-preview URLs, mismatched
database project refs, non-`app_runtime` identities, and live client tokens.
An unpredictable event fixture must be readable with the staging-only client
before the first HTTP registration write, proving the tested deployment can
reach this staging fixture. The guard does not inspect deployment environment
configuration; the operator must verify that separately. The staging role is
also checked for no superuser/BYPASSRLS or direct application-table grants.

The fifth accepted attempt in the second window is submitted through the real
Landing browser form. Its Core POST must contain only attendee fields and intent,
with no cookie, API key, platform token or client-supplied IP. The harness checks
the confirmation UI, request-ID echo and absence of automatic retries. Capture
the Landing identity privately with `vercel project token essqu-web --json
--scope eng-crafters`; the helper never sends it to Core.

API tokens permit underscores in both their prefix and base64url secret. The
Core parser now checks all syntactically valid prefix delimiters (at most 33)
in one parameterized registry query using the full-token hash. A greedy split
could previously misidentify a valid prefix when its secret contained an
underscore. Existing token formats and stored clients remain valid; this fix
requires no schema migration. Disposable database regressions exercise the
actual query as `app_runtime`, including missing scope, wrong hash and revocation.

The suite creates a uniquely named synthetic committee and 28 event fixtures,
including enough published events for cursor pagination, and uses only
`@example.test` attendee identities. It verifies 401/403/200 reads, exact public
fields, draft/archive privacy, upcoming/past behavior, pagination, cache and
request IDs, CORS and header exposure, malformed/oversized/invalid bodies,
normal registration, all five conflict reasons, explicit waitlisting, a
two-request race for one seat, persisted counts, and a real 429/Retry-After.
Read-only reconciliation checks one matching anonymous audit per successful
registration and verifies that the synthetic waitlist entry follows seat
allocation. It does not promote registrations or claim a multi-entry FIFO
promotion test.
Its browser Origin is pinned to the staging Landing deployment,
`https://essqu-web-git-staging-eng-crafters.vercel.app`, which must be present
in the Core preview's exact CORS allowlist.

Allow approximately eleven minutes. The canonical limit is five attempts per
ten minutes for the actual Vercel edge IP; spoofed address headers are never
sent. The suite waits 610 seconds between two controlled windows and prints a
progress line every 30 seconds. Start with a quiet egress address that has not
registered in staging in the previous ten minutes. Other registration traffic
from that address can cause an assertive failure. An unexpected 429 is a failure;
registration writes are never retried automatically.

Cleanup in `finally` removes only the exact synthetic run's audit, registration,
event, and committee records in FK order, then checks for leftover fixtures.
Preexisting data is never changed. Global per-IP attempt rows are deliberately
retained because they cannot be attributed safely to an event; their limiter
effect expires naturally, and the normal attempt-retention procedure still
applies. If cleanup fails, the summary prints the synthetic run ID for a
targeted staging-only cleanup. A process killed externally may require that same
manual cleanup; no test can promise a `finally` block after forced termination.

The older `scripts/api-http-e2e.mjs` is a local diagnostic that prints observations
and starts its own database. It is not release evidence for this deployed
staging `app_runtime` flow. Use this assertive harness for that evidence.
