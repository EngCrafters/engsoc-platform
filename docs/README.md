# Core developer documentation

`engsoc-platform` ("Core") is the Engineering Society's system of record. It provides:

- the versioned public API at `/v1`, used by the separate public website;
- the administration dashboard at `/admin`;
- Supabase Auth integration;
- every business rule, enforced in PostgreSQL routines.

This index is the entry point for developers. The documents describe the checked-out
implementation. They do not assume that any hosted environment matches it.

## Version documented

| Item                    | Value                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | `https://github.com/EngCrafters/engsoc-platform.git` (remote `origin`)                                                                                                  |
| Branch                  | `salim`, tracking `origin/salim` (no unpushed commits)                                                                                                                  |
| Commit                  | `b4ec91faf17ff93566a671b8f074bd8bc70aaa6f` (2026-10-22, "docs: record the staging rollout of 0032 and its verification")                                                |
| Relation to `main`      | `origin/main` (`60f2525`) contains only three extra merge commits; its file tree is identical to this commit                                                            |
| Inspection date         | 2026-10-24                                                                                                                                                              |
| Working tree            | Clean before this documentation was written. The only uncommitted changes are these documentation files and a documentation link added to `README.md` and `CLAUDE.md`.  |
| Framework               | Next.js 16.4.2 (App Router; production build with webpack), React 19.2.8, TypeScript 5.9.3                                                                              |
| Data and Auth           | Supabase PostgreSQL (schema version 32 required), `postgres` 3.4.9, Drizzle ORM 0.45.2 and drizzle-kit 0.31.10, `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.116.0 |
| Other notable libraries | Tailwind CSS 4.3.3, Radix UI 1.6.7, `sharp` 0.35.5, `qrcode` 1.5.4                                                                                                      |
| Tooling                 | Node.js 22 (CI), npm (`package-lock.json` v3), Vitest 5.0.0, Playwright 1.63.0, ESLint 9.39.5, Prettier 3.9.6, Husky 9.1.7, commitlint                                  |

Versions are the resolved versions in `package-lock.json`.

## Recommended reading order

1. [Getting started](onboarding/getting-started.md): install, configure, run and test.
2. [Architecture](explanation/architecture.md): boundaries, request lifecycle, the database
   routine model.
3. [Roles and permissions](reference/roles-and-permissions.md): who can do what, and where it is
   enforced.
4. [Business workflows](explanation/workflows.md): membership, sign-in, events, attendance,
   projects, committees, deletion.
5. [API reference](reference/api.md) and [Dashboard reference](reference/dashboard.md).
6. Database:
   - [Database schema](reference/database-schema.md);
   - [Database security](reference/database-security.md);
   - [Storage](reference/storage.md);
   - [Migrations](how-to/migrations.md).
7. [Configuration](reference/configuration.md): every environment variable and API-key
   provisioning.
8. [System integration guide](integration/system-integration.md): how Core and the website work
   together.
9. [Operations](how-to/operations.md) and [Development guide](how-to/development-guide.md).
10. [Known gaps](known-gaps.md) and [Documentation maintenance](maintenance.md).

## Documents by purpose

| Purpose     | Documents                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding  | [Getting started](onboarding/getting-started.md)                                                                                                                                                                                                                                                              |
| How-to      | [Development guide](how-to/development-guide.md), [Migrations](how-to/migrations.md), [Operations](how-to/operations.md)                                                                                                                                                                                      |
| Reference   | [API](reference/api.md), [Dashboard](reference/dashboard.md), [Roles and permissions](reference/roles-and-permissions.md), [Database schema](reference/database-schema.md), [Database security](reference/database-security.md), [Storage](reference/storage.md), [Configuration](reference/configuration.md) |
| Explanation | [Architecture](explanation/architecture.md), [Business workflows](explanation/workflows.md), [System integration](integration/system-integration.md)                                                                                                                                                          |
| Status      | [Known gaps](known-gaps.md), [Documentation maintenance](maintenance.md)                                                                                                                                                                                                                                      |

## Evidence labels

| Label        | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **Source**   | Verified by reading source, migrations or configuration at the commit above                      |
| **Tests**    | Covered by a repository test. The tests were read, not executed, during this documentation task. |
| **Deployed** | Seen in a deployed environment through read-only, unauthenticated requests on the stated date    |
| **Inferred** | Concluded from the evidence, not proven directly                                                 |
| **Unknown**  | Not verifiable from the repository; the known-gaps list says what to check                       |

Unlabelled statements about code are **Source**. The database facts were also checked read-only
against a disposable local replay of all migrations (see [Database schema](reference/database-schema.md)).
No hosted database was queried.

## Existing documents

These predate this documentation set and remain in place. When they disagree with the source,
the source wins; [Known gaps](known-gaps.md) lists the disagreements found.

| Kind                         | Documents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governing documents (PDF)    | `Idea_and_Requirements_Document.pdf`, `Technical_Blueprint.pdf`, `Phase0_Team_Playbook.pdf`, `UC-01_Deep_Dive.pdf`                                                                                                                                                                                                                                                                                                                                                                                   |
| Decisions                    | [`adr/`](adr/) 0001–0024: why the system is built this way                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Specifications and contracts | [`UC-02_Deep_Dive.md`](UC-02_Deep_Dive.md), [`UC-02_Data_and_Security.md`](UC-02_Data_and_Security.md), [`UC-02_Acceptance_and_Delivery.md`](UC-02_Acceptance_and_Delivery.md), [`UC-01_Membership_Applications.md`](UC-01_Membership_Applications.md), [`ACCESS_CONTROL.md`](ACCESS_CONTROL.md), [`api/openapi.v1.yaml`](api/openapi.v1.yaml), [`api/PROJECTS.md`](api/PROJECTS.md), [`api/EVENT_ATTENDANCE.md`](api/EVENT_ATTENDANCE.md), [`api/LANDING_HANDOFF_V1.md`](api/LANDING_HANDOFF_V1.md) |
| Operations and runbooks      | [`AUTH_AND_EMAIL.md`](AUTH_AND_EMAIL.md), [`Platform_Maintenance_Runbook.md`](Platform_Maintenance_Runbook.md), [`api/PRODUCTION_CUTOVER_RUNBOOK.md`](api/PRODUCTION_CUTOVER_RUNBOOK.md), [`api/CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md`](api/CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md), [`api/STAGING_HTTP_E2E.md`](api/STAGING_HTTP_E2E.md), [`UC-01_Staging_Rollout.md`](UC-01_Staging_Rollout.md), [`STAGING_ROLLOUT_0027_0030.md`](STAGING_ROLLOUT_0027_0030.md)                                               |
| State and history            | [`CURRENT_WORK.md`](CURRENT_WORK.md) (dated handoff notes, newest first), [`UC-02_Release_Notes.md`](UC-02_Release_Notes.md), [`api/PRE_DOMAIN_RELEASE_REPORT.md`](api/PRE_DOMAIN_RELEASE_REPORT.md), [`HARDENING_AUDIT_2026-10-07.md`](HARDENING_AUDIT_2026-10-07.md), [`HARDENING_PRE_PUBLIC_API.md`](HARDENING_PRE_PUBLIC_API.md)                                                                                                                                                                 |
| Design                       | [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Module notes                 | `README.md` files in `db/`, most `lib/*` folders, `components/admin`, `components/auth`, `app/(marketing)` and each `tests/*` suite                                                                                                                                                                                                                                                                                                                                                                  |

## The public website

The website is a separate repository (`EngCrafters/essqu-web`, usually checked out as
`ESWebsite/` next to this one). Its documentation starts at its
[docs/README.md](https://github.com/EngCrafters/essqu-web/blob/main/docs/README.md). The shared
[system integration guide](integration/system-integration.md) is kept here.
