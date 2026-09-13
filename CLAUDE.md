@AGENTS.md

# Engineering Society Platform

Read this before doing anything in this repo. It's the short version of documents
that already exist and are approved, not a new source of truth, if something here
ever conflicts with the PDFs in `/docs`, the PDFs win and this file is out of date.

## What this project is

One shared platform replacing scattered forms, chat groups, and Drive folders.
Every member, event, and project is a permanent record. Full explanation:
`/docs/Idea_and_Requirements_Document.pdf`.

## Current status

- Phase 0 (Foundation): charter, requirements, architecture, and roles are
  done. Standards and infra (this repo) are in progress.
- **Build order has been deliberately reordered.** UC-02 (event/workshop
  announcement, registration, and an admin dashboard) is being built
  first. UC-01 (member profiles) is deferred, not cancelled, see below.
- Use case numbers are catalog IDs from the requirements document, not a
  mandated build sequence. Don't assume UC-01 must be built before UC-02
  just because of the numbering, check this section for the real order.

## Current build decision: event registration without member accounts

Registering for an event must work with **no member profile in
existence yet**, since UC-01 hasn't been built. This is a real schema
decision, not just a priority change:

- `registrations.memberId` changes from `NOT NULL` to **nullable**.
- New fields on `registrations`: `attendeeName` (text, required),
  `attendeeEmail` (text, required). This is how a registration captures
  who the person is without a Member row.
- When UC-01 eventually ships, a person can link their past registrations
  to their new member profile (likely matched by email). That linking
  flow is not built yet, don't build it speculatively now, just don't
  make a schema choice that blocks it later.
- Every place that currently assumes `registration.memberId` is always
  present (certificate generation, attendance display) needs to handle
  the null case. Check before assuming.

This was considered against creating a separate `Attendee` entity instead
of touching `Member`'s relationship. Rejected: it adds an entity now that
would likely get merged into Member later, schema churn without real
benefit at this stage. Keeping one `Registration` table with optional
`memberId` is the smaller, more honest change.

## The admin dashboard, new scope

Committees need a view to manage events and see who's registered, this
is new scope beyond what UC-02's original spec covered (which only
described the public-facing announce-and-register flow). Before building
it:

- Write a proper deep-dive for this (mirror `UC-01_Deep_Dive.pdf`'s
  format: fields, every real situation, open decisions). Don't build
  from a one-line description.
- At minimum it needs: event list (draft/published/full), create/edit
  event, and a per-event registration list with attendee count.
- Decide and document: who can see which committee's events (this is
  where NFR-03's role-based access actually gets implemented for the
  first time), and whether registration data can be exported.

## How we work

This project is built by a small team with a single technical lead who
reviews and approves all work before it merges. Other contributors are
still building technical skill and work through a structured process:
small, AI-assisted tasks first, then drafting real pieces under review,
then light independence once several pieces have gone through cleanly.
Full model: `/docs/Phase0_Team_Playbook.pdf`.

When working with a contributor who is still learning: favor small,
well-explained changes over large ones. Explain _why_, not just _what_, in
plain language, they are learning the system as they go, not just shipping
code. Do not touch files outside the current use case's scope without
flagging it first.

## Stack

- **Next.js** (App Router, TypeScript, Tailwind), deployed on **Vercel**.
- **Supabase**: Postgres database, authentication, and file storage, all in
  one project.
- **Drizzle ORM** for typed database access — schema in `db/schema.ts`,
  client in `db/index.ts`.
- **Resend** for transactional email.

Supabase's MCP server is connected in Claude Code for this project, so
Claude can inspect the schema, run queries, and manage auth/storage
directly, ask it to check something in the database rather than opening
the Supabase dashboard.

Full reasoning for every choice, including the earlier Cloudflare-based
stack this replaced and why: `/docs/Technical_Blueprint.pdf`.

## Data model

`db/schema.ts` is the full, current schema. It was a direct implementation
of the ER diagram in `/docs/Technical_Blueprint.pdf`, Part 2, **that
diagram is now out of date on one point**: `registrations.memberId` is
shown there as required. It isn't anymore, see "Current build decision"
above. Update the ER diagram to match before this drifts further, the
diagram should describe reality, not the other way around.

**Never add a column or table that isn't backed by a written decision.** If
a feature needs new data, that's a new entry in the ER diagram and a short
ADR note first, then a schema change. Not the other way around.

## Standards

These are enforced by tooling, not just written down, see `.husky/` and
`.github/workflows/ci.yml`.

- Git: feature branches, [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`). A commit that doesn't follow this format is
  rejected locally by the `commit-msg` hook before it's even made.
- `npm run lint` runs automatically before every commit (`pre-commit` hook).
  CI re-runs lint, a full type-check, and a production build on every push
  and pull request, so a broken build can't reach `main` even if a hook was
  bypassed locally.
- One review from the technical lead before merging to `main`, no
  exceptions for contributors still building skill. Use
  `.github/PULL_REQUEST_TEMPLATE.md`, it's applied automatically, don't
  delete the checklist.
- Every module/feature gets a short `README.md` in its folder: what it does,
  how it connects to the rest of the system.
- Separate environments: never run migrations or seed data against
  production.
- Role-based access: a committee can only manage its own events and data.

Deployment itself runs through Vercel's own GitHub integration (auto-deploy
on push to `main`, preview deploys on PRs), not a custom Actions workflow,
don't build a second deploy pipeline that fights with it.

## Prompting practices

When asking Claude (chat or Claude Code) to build or change something in
this repo, a good prompt does three things: names the UC number, says what
"done" looks like, and says what NOT to touch.

Weak: _"add event registration"_
Better: _"Implement UC-02's public registration flow (see the use case's
main flow). Done means an event can be published, a visitor can register
with just name and email, no login required, and a confirmation is shown.
Don't build the admin dashboard yet, that's separate scope."_

The second version gets a smaller, more correct diff, because Claude isn't
guessing at scope. This matters more, not less, when the person prompting is
still learning, a vague prompt produces a plausible-looking answer that's
easy to accept without noticing it drifted from the actual use case.

If you're not sure what "done" looks like for a piece of work, that's a sign
to go re-read the relevant doc in `docs/` before prompting, not a sign to
prompt vaguely and see what comes back.

## System design principles

These come directly from the ER diagram and ADRs in
`docs/Technical_Blueprint.pdf`, restated here as working rules:

- **The data model is the contract.** A feature that needs new data updates
  the ER diagram first, then the schema, then the code. Never the reverse.
- **No silent duplication.** If a fact already lives somewhere, don't store
  it again elsewhere "for convenience." Two copies of a fact will
  eventually disagree.
- **Open decisions stay open, not guessed at.** If a doc marks something as
  an open decision, implementing around it with an assumption is how the
  schema ends up needing to change later. Flag it instead.
- **Match the use case's main flow step for step.** The order in the
  document is deliberate. If the real implementation needs to diverge,
  that's a conversation and a doc update, not a quiet judgment call.
- **Every phase gate is real**, but **build order within a phase can be
  deliberately chosen**, as it was here. What's not allowed is silently
  drifting from the documented order, it has to be a stated decision,
  written down, same as this one was.

## Working with Claude Code specifically

- Keep tool-use confirmations on. Do not run in a fully auto-accepting
  mode while contributors are still building skill, each confirmation is
  a checkpoint where the person driving should understand what's about to
  happen before it happens.
- Prefer opening a branch and a pull request over committing directly to
  `main`, even for small changes, the PR template's checklist is part of
  the review process, not paperwork.
- If a request is ambiguous about scope, ask before touching multiple use
  cases or modules at once. Small, reviewable diffs over large, sweeping
  ones.

## Skills

`.claude/skills/implement-use-case/` encodes how any UC gets built. More
skills will be added here over time for specific domains, UI and design
conventions, testing patterns, and so on. When a new skill is added, it
should read the docs in `docs/` the same way this file does, treat them as
the source of truth, not duplicate or contradict them.

## Use cases

All seven live in `/docs/Idea_and_Requirements_Document.pdf`. Each has
actors, precondition, trigger, main flow, alternate/exception flow, and
postcondition, plus a workflow diagram. When implementing a use case, match
its main flow step for step. If the real behavior needs to differ from the
document, that's a conversation with the technical lead and a document
update, not a silent code change.

Currently active: **UC-02, Website event & workshop announcement +
registration, plus the new admin dashboard scope described above.**
UC-02's original spec is in `/docs/Idea_and_Requirements_Document.pdf`;
there is no deep-dive doc for it yet, write one (mirroring
`UC-01_Deep_Dive.pdf`) before building the dashboard specifically.

**UC-01 (member registration & profile) is deferred, not cancelled.** Its
existing deep-dive doc (`/docs/UC-01_Deep_Dive.pdf`) is still accurate for
when that work resumes, nothing in it needs to change because of this
reordering.

### How this line gets updated

This "Currently active" line is the single source of truth for what should
be worked on. **It does not update itself.** Nothing in this repo watches
for a use case finishing and moves this line automatically, that only
happens when someone deliberately edits this file.

- **Before starting work**: confirm what's being asked matches this line.
  If someone asks for a different use case than what's listed here, stop
  and flag the mismatch rather than assuming the line is just stale and
  proceeding anyway.
- **Before closing out a use case**: check its definition of done in the
  matching deep-dive doc. Every box needs to be checked, not just "the
  code runs."
- **Closing a use case includes updating this line**, in the same PR that
  finishes the last piece, or a dedicated `docs: move to UC-0X` commit
  right after. A use case isn't actually closed until this file says so.
