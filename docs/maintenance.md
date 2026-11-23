# Documentation maintenance

The developer documentation lives in this repository and changes in the **same commit** as the
code it describes. CI runs `npm run format:check`, which includes every tracked Markdown file,
so format documentation with Prettier (`npx prettier --write <file>`) before committing.

## What to update when code changes

| When you change…                                                           | Update                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A route under `app/v1/` (new endpoint, method, field, status, CORS, limit) | [API reference](reference/api.md); `docs/api/openapi.v1.yaml`; the [integration guide](integration/system-integration.md#contract-map) contract map                                                                                                                         |
| A dashboard page, server action or `app/admin/**/route.ts`                 | [Dashboard](reference/dashboard.md); [Roles and permissions](reference/roles-and-permissions.md) if access changes                                                                                                                                                          |
| A migration                                                                | [Database schema](reference/database-schema.md); [Database security](reference/database-security.md) (regenerate the routine catalog if routines or grants change); [Migrations](how-to/migrations.md#what-is-applied-where) when applied somewhere; `docs/CURRENT_WORK.md` |
| A role, scope, reviewer rule or `administrative_access` behaviour          | [Roles and permissions](reference/roles-and-permissions.md); `ACCESS_CONTROL.md`; an ADR                                                                                                                                                                                    |
| A business workflow (events, membership, projects, committees, deletion)   | [Workflows](explanation/workflows.md)                                                                                                                                                                                                                                       |
| Any `process.env` read, `.env.example`, `next.config.ts`, `proxy.ts`       | [Configuration](reference/configuration.md); [Getting started](onboarding/getting-started.md)                                                                                                                                                                               |
| Storage keys, buckets, image processing, the deletion queue                | [Storage](reference/storage.md)                                                                                                                                                                                                                                             |
| Scripts, CI, the release gate, deployment or domains                       | [Operations](how-to/operations.md); [Getting started](onboarding/getting-started.md)                                                                                                                                                                                        |
| Anything the website consumes                                              | The [integration guide](integration/system-integration.md), and ESWebsite's [Core API consumption](https://github.com/EngCrafters/essqu-web/blob/main/docs/reference/core-api-consumption.md) in that repository                                                            |
| A finding is fixed or discovered                                           | [Known gaps](known-gaps.md)                                                                                                                                                                                                                                                 |

When you re-verify the whole set, update the version table in [README](README.md#version-documented).

## Regenerating database facts

The column, constraint, policy and routine lists were taken from a disposable local database
built by replaying the migrations. To refresh them without touching a hosted project:

1. Run `npm test` with Docker, or point `TEST_DATABASE_URL` at a loopback PostgreSQL 17 database
   named with `uc02_test`. The harness replays every migration.
2. Query the catalog **read-only**:
   - `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_policies`;
   - `pg_proc` with `has_function_privilege('app_runtime', oid, 'EXECUTE')`;
   - `pg_trigger`, `information_schema.role_table_grants` and `column_privileges`.
3. Ignore test-harness objects (for example `private.unapproved_probe` and the `auth` stub).

## Writing rules

- Describe what the code does now, with links to the files and routines that prove it. Plans
  belong in ADRs or use-case documents.
- Label anything not read from source: **Tests** (not executed), **Deployed** (with the date and
  method), **Inferred**, **Unknown**.
- Never include secrets, tokens, connection strings, real email addresses, student IDs or other
  personal data. Use fictional examples (`student@example.test`, `essq_test_exampleprefix_<secret>`).
- Keep API, database and permission details canonical here, and link to them from the website.

## Checklist for AI-assisted changes

Before finishing a change made with an AI assistant:

1. **Update the docs** in the table above, in the same change.
2. **Verify every changed claim against the code**: names, limits, defaults, status codes, roles,
   routine names. Open the linked file; do not rely on memory or older documents.
3. **Check links.** Every relative link and anchor must resolve, and cross-repository links must
   point to files on the other repository's `main`.
4. **Check Mermaid diagrams** still match the flow.
5. **Run `npm run format:check`**, and scan the diff for secrets and personal data.
6. **Report what remains unknown** (hosted state, untested paths) in [Known gaps](known-gaps.md).
