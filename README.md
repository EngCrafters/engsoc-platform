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
   specification and its explicitly open decisions. UC-01's deep dive remains
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
npm run db:migrate           # applies db/schema.ts to your Supabase database
npm run dev
```

## Project structure

```
app/                  Next.js App Router pages and routes
db/schema.ts           The full data model, matches the ER diagram exactly
db/index.ts             Drizzle client, server-only
lib/supabase.ts         Supabase client helpers (browser + server)
docs/                   Governing PDFs and use-case implementation specifications
.claude/skills/         Claude Code skills for this project
drizzle.config.ts       Database migration config
```

## Current status

**Phase 0 (Foundation):** done, except this repo, which is what you're
looking at right now.

**Phase 1 (Registration):** UC-02 (public event announcement and registration)
is the active use case. UC-01 (member profiles) is deliberately deferred,
not cancelled. See `CLAUDE.md` for the build-order decision and
`docs/UC-02_Deep_Dive.md` for the implementation scope and open decisions.

## How we work

- One use case at a time, whole team together, not split into separate
  areas. See the Phase0 Team Playbook for the reasoning.
- Level 1 → 2 → 3 learning ladder for teammates new to building software.
  Nothing goes to production without Hisham's review while at Level 1–2.
- Conventional Commits, one review before merge, every module documented.
  Full list in `CLAUDE.md`.

## Enforced, not just written down

- **Commit messages** are checked by a git hook (`.husky/commit-msg`), a
  non-conventional commit is rejected before it's made.
- **Lint** runs automatically before every commit (`.husky/pre-commit`).
- **CI** (`.github/workflows/ci.yml`) re-runs lint, a full type-check, and a
  production build on every push and pull request.
- **Pull requests** use `.github/PULL_REQUEST_TEMPLATE.md`, which asks for
  the UC number and a definition-of-done checklist.

Run `npm install` once after cloning, the git hooks install automatically
via the `prepare` script.
