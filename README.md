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
4. **`docs/UC-01_Deep_Dive.pdf`** — the use case we're building right now.

If you're using Claude Code in this repo, it reads `CLAUDE.md` automatically
and already knows all of the above.

## Stack

Next.js (Cloudflare Pages) · Cloudflare D1 (database) · Cloudflare R2 (file
storage) · Better Auth (authentication) · Resend (email)

See `docs/Technical_Blueprint.pdf` for why.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values, see comments in the file
npm run dev
```

## Project structure

```
app/                  Next.js App Router pages and routes
db/schema.ts           The full data model, matches the ER diagram exactly
docs/                   The four governing PDFs, read these first
.claude/skills/         Claude Code skills for this project
wrangler.toml           Cloudflare Pages / D1 / R2 configuration
drizzle.config.ts       Database migration config
```

## Current status

**Phase 0 (Foundation):** done, except this repo, which is what you're
looking at right now.

**Phase 1 (Registration):** starting now. Working on UC-01 as a whole team
before moving to UC-02. See `docs/UC-01_Deep_Dive.pdf` for the three
first jobs assigned to Salim, Ibrahim, and Zaher.

## How we work

- One use case at a time, whole team together, not split into separate
  areas. See the Phase0 Team Playbook for the reasoning.
- Level 1 → 2 → 3 learning ladder for teammates new to building software.
  Nothing goes to production without Hisham's review while at Level 1–2.
- Conventional Commits, one review before merge, every module documented.
  Full list in `CLAUDE.md`.
