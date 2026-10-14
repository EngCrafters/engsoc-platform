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

## Working on the public site (`app/(marketing)/`)

This is the public event-discovery and registration surface: the landing page,
the event catalogue, event detail and anonymous registration. It is part of the
same application and data model as the rest of the platform — not a separate
site, and not a separate repository.

Registration captures an attendee's name, email and phone; email is the
registration identity and the phone is contact detail, private to the
committee-scoped administration area.

Events come from `lib/events` and nowhere else. `lib/marketing/adapters.ts` is
the single translation point from the canonical `PublicEvent` DTO to
presentation, and it never widens that DTO. Registration posts to the canonical
Server Action, which calls `private.register_for_event`; duplicate prevention,
capacity, the FIFO waitlist, the IP rate limit and the audit row all remain the
database's job.

The public palette is scoped to a `.marketing-surface` class and the public
language direction is applied to that subtree rather than to `<html>`, so the
committee dashboard keeps its own monochrome tokens, its Geist faces and its
left-to-right English. `app/(marketing)/README.md` has the full rules.

**What `app/(marketing)/` is.** It's the landing page and event
registration flow: everything a visitor sees without logging in. It lives
in this same repo (not a separate one) specifically so it can read events
directly from the database code the rest of the app uses
(`lib/events`'s `getPublishedEvents`) instead of calling a separate API.
Domain and database behavior lives in `lib/` and `db/`; do not duplicate it
in this route group. Follow the active UC-02 specification and its open
decisions before changing those boundaries.

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
app/(marketing)/        The public site — see "Working on the public site" below
db/schema.ts            Implemented schema; UC-02 target ER addendum is in docs/
db/index.ts             Drizzle client, server-only
lib/events/             Domain module: reading published events (public DTO)
lib/marketing/          Typed adapter from the canonical PublicEvent DTO to presentation
lib/i18n/               English/Arabic dictionaries and the server-resolved locale
content/                Presentation content with no database backing (a programme
                        catalogue, the society overview, figures, structure). Every
                        unverified value carries a flag that renders a visible label.
components/marketing/   The public site's components
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

**Phase 1 (Registration):** UC-02's authentication and access-control milestone
is complete. The public site — previously maintained as a separate prototype
repository by a teammate — has been migrated into `app/(marketing)/` as
presentation over the canonical event and registration domains. UC-01 (member profiles) is deliberately deferred, not cancelled. See
`docs/CURRENT_WORK.md` for current evidence and outstanding verification.

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
