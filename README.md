# Engineering Society Platform

One shared platform for the society: member accounts, event registration,
attendance, certificates, the project/magazine archive, and the graduate
network, all living on the same permanent data instead of scattered forms,
chat groups, and Drive folders.

Start here, in order:

1. **`docs/Idea_and_Requirements_Document.pdf`** — the idea, why it matters,
   and the seven approved use cases (UC-01 through UC-07).
2. **`docs/Technical_Blueprint.pdf`** — the full data model and the stack,
   with the reasoning behind every technical decision.
3. **`docs/Phase0_Team_Playbook.pdf`** — who's on the team, how we work, and
   the learning model for teammates who are still non-technical.
4. **`docs/UC-02_Deep_Dive.md`** — the active use case's implementation
   specification, linked data/security contract, test plan, and freeze gate.
   UC-01's deep dive remains
   authoritative when that deferred work resumes.

If you're using Claude Code in this repo, it reads `CLAUDE.md` automatically
and already knows all of the above.

## Stack

Next.js (Vercel) · Supabase (Postgres, auth, storage) · Drizzle ORM · Resend
(email)

Supabase's MCP server is connected in Claude Code, so Claude can inspect
the schema and query the database directly. See `docs/Technical_Blueprint.pdf`
for the full reasoning, including the earlier Cloudflare-based stack this
replaced.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values from your Supabase project
npm run db:migrate           # replays journaled migrations; confirm a DEVELOPMENT target first
npm run dev
```

Do not run migrations during the UC-02 specification gate. The historical
staging-only 0002 SQL is not in the Drizzle journal; the UC-02 data contract
specifies its forward reconciliation. A schema file is not itself a migration.

## Core and the separate public site

This repository owns Core administration, Auth, event and registration rules,
and the versioned `/v1` public API. Its existing `app/(marketing)/` pages remain
the current public surface while the separate landing site is prepared.

The landing source is preserved in the private repository
[`EngCrafters/essqu-web`](https://github.com/EngCrafters/essqu-web), connected to
the separate Vercel project `essqu-web`. GitHub reports `EngCrafters` as a **User**
namespace, not an Organization. ADR 0016 defines this separation. Landing reads
Core events server-to-server with an `events:read` credential and submits public
registration requests through the API; it receives no database or admin secret.
Core remains the authority for capacity, waitlist, duplicates, audit and access.

**Running it locally.** Obtain the staging `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and restricted `APP_RUNTIME_DATABASE_URL`.
Confirm that all three target the staging project before starting. `DATABASE_URL`
is a separate migration/admin credential and is never a runtime fallback; do not
infer its target from the environment filename. Public-site development does not
require a service-role key or production credential.

```bash
npm install
cp .env.example .env.local   # paste in the staging values Hisham gives you
npm run dev
```

Then open `http://localhost:3000` — you should see the seeded staging
events and be able to submit the registration form against the staging
database.

**Delivery.** Routine work is committed directly to `main` after self-review
and validation. Pushes to `main` run GitHub Actions and trigger Vercel's
production deployment; inspect both and repair failures. Pull requests are
reserved for exceptional collaboration, not the normal delivery path.

## Project structure

```
app/                    Next.js App Router pages and routes
app/(marketing)/        Existing Core public pages during pre-domain preparation
app/v1/                 Versioned public API transport adapters
db/schema.ts            Implemented schema; UC-02 target ER addendum is in docs/
db/index.ts             Drizzle client, server-only
lib/events/             Domain module: reading/publishing events
lib/registrations/      Domain module: registering for an event
lib/auth/server.ts      Caller-scoped Supabase Auth client
lib/auth/admin.ts       Technical-only server Auth administration
docs/                   Governing PDFs and use-case implementation specifications
.claude/skills/         Claude Code skills for this project
drizzle.config.ts       Database migration config
```

## Current status

**Phase 0 (Foundation):** done, except this repo, which is what you're
looking at right now.

**Pre-domain release preparation (October 18, 2026):** Core production remains
at `https://engsoc-platform.vercel.app`. Staging has migration 0024; production
does not. The owner waived managed-backup readiness only for unchanged additive
0024 after successful live staging and concurrency checks; no backup is claimed. Landing
provisioning and staging integration verification are in progress; custom domains,
DNS, Auth origins and host enforcement remain unchanged. UC-01 remains deferred.
See [current work](docs/CURRENT_WORK.md), the
[API handoff](docs/api/LANDING_HANDOFF_V1.md), and the
[custom-domain cutover checklist](docs/api/CUSTOM_DOMAIN_CUTOVER_RUNBOOK.md).

## How we work

- One use case at a time, whole team together, not split into separate
  areas. See the Phase0 Team Playbook for the reasoning.
- The historical learning model is preserved in the Phase 0 playbook; the
  current engineering workflow is direct-main and documented in ADR 0007.
- Conventional Commits, autonomous self-review, and module documentation.
  Full current rules are in `CLAUDE.md` and `AGENTS.md`.

## Enforced, not just written down

- **Commit messages** are checked by a git hook (`.husky/commit-msg`), a
  non-conventional commit is rejected before it's made.
- **Lint** runs automatically before every commit (`.husky/pre-commit`).
- **CI** (`.github/workflows/ci.yml`) re-runs lint, type-checks, tests, and a
  production build on every push to `main`.
- **Pull requests** are optional exceptional-collaboration artifacts; their
  template is not part of the normal delivery path.

Run `npm install` once after cloning, the git hooks install automatically
via the `prepare` script.
