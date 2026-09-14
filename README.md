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

## Working on the public site (`app/(marketing)/`)

This section is for someone outside the core team helping with just the
public-facing site — you don't need any of the context above to be
productive here.

**What `app/(marketing)/` is.** It's the landing page and event
registration flow: everything a visitor sees without logging in. It lives
in this same repo (not a separate one) specifically so it can read events
directly from the database code the rest of the app uses
(`lib/events`'s `getPublishedEvents`) instead of calling a separate API.
**You only need to work inside `app/(marketing)/`.** Everything else in
this repo — `db/`, `lib/`, the admin dashboard when it exists — is core
team scope. If a change you're making would touch something outside that
folder, that's worth a message to Hisham first, not a judgment call.

**Running it locally.** Ask Hisham for the staging environment's values
(a `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`DATABASE_URL`) — these point at a separate staging Supabase project with
its own fake seeded events, not the real one. You will never be given a
service role key or a production credential; you don't need either to work
on the public site.

```bash
npm install
cp .env.example .env.local   # paste in the staging values Hisham gives you
npm run dev
```

Then open `http://localhost:3000` — you should see the seeded staging
events and be able to submit the registration form against the staging
database.

**Opening a PR.** Push your branch and open a pull request as normal.
Vercel automatically builds a live preview link and posts it on the PR
within a minute or two — you don't need your own Vercel account or any
Vercel access to get one. Hisham reviews every PR (see `CODEOWNERS`)
before it merges to `main`.

## Project structure

```
app/                    Next.js App Router pages and routes
app/(marketing)/        The public site — see "Working on the public site" below
db/schema.ts           The full data model, matches the ER diagram exactly
db/index.ts             Drizzle client, server-only
lib/events/             Domain module: reading/publishing events
lib/registrations/      Domain module: registering for an event
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
