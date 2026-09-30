@AGENTS.md

# Engineering Society Platform

Read this before doing anything in this repo. It's the short version of documents
that already exist and are approved. The PDFs in `/docs` are the baseline;
later explicit owner decisions recorded in ADRs and use-case specifications
supersede only the details they identify. An unresolved contradiction remains
open rather than being silently decided by implementation.

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

- Read the existing `docs/UC-02_Deep_Dive.md` and its data/security and
  acceptance/delivery companions. They now specify the dashboard.
- At minimum it needs: event list (draft/published/full), create/edit
  event, and a per-event registration list with attendee count.
- Committee-scoped access and event-scoped CSV are specified there.
  The owner answered publication approval authority (O-01) with per-committee
  two-manager review when review is required.

The UC-02 specification freeze passed at commit `9c5b733` and CI verified it.
The current milestone is **UC-02 M8 release and closure**. Earlier milestones
have been implemented in dependency order; use `docs/CURRENT_WORK.md` for the
current release gate and exact handoff task.

## How we work

Codex is the primary technical implementation agent and owns routine
engineering work end-to-end. The historical team-learning model remains in
`/docs/Phase0_Team_Playbook.pdf`; its former branch/review process is
superseded for current development by
`docs/adr/0007-direct-main-development-workflow.md`.

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

`db/schema.ts` describes the implemented schema. The historical ER diagram in
`/docs/Technical_Blueprint.pdf`, Part 2, predates nullable Member links.
`docs/UC-02_Data_and_Security.md` is the UC-02 ER addendum and approved data
contract; the UC-02 migrations through 0015 are applied to staging and the
selected main project.
See ADRs 0004 and 0008. A target specification is not proof that the live
database or applied migrations already match.

**Never add a column or table that isn't backed by a written decision.** If
a feature needs new data, that's a new entry in the ER diagram and a short
ADR note first, then a schema change. Not the other way around.

## Standards

These are enforced by tooling, not just written down, see `.husky/` and
`.github/workflows/ci.yml`.

- Git: work directly on `main` using small,
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
  `fix:`, `docs:`, etc.). A commit that doesn't follow this format is rejected
  locally by the `commit-msg` hook before it's even made.
- `npm run lint` runs automatically before every commit (`pre-commit` hook).
  Before a meaningful push, Codex self-reviews the diff and runs the relevant
  lint, type-check, tests, migration/RLS validation, and production build.
  CI repeats the required checks on every push to `main`.
- Pull requests are exceptional, not routine. The optional template remains
  available for an exceptional collaboration change; it is not a merge gate.
- Every module/feature gets a short `README.md` in its folder: what it does,
  how it connects to the rest of the system.
- Separate environments: never run migrations or seed data against
  production.
- Role-based access: a committee can only manage its own events and data.

Deployment runs through Vercel's GitHub integration: a push to `main`
deploys production. Inspect GitHub Actions and the Vercel deployment after
every meaningful push; diagnose and repair failures without adding a second
deployment pipeline. Preview deployments for exceptional PRs are optional.

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

- Follow the same direct-main workflow as Codex: self-review, validate,
  commit coherent changes to `main`, push, then verify CI and Vercel.
- Do not routinely create branches or PRs, and do not wait for routine human
  approval. Use the optional PR template only for exceptional collaboration.
- If scope or product policy is genuinely ambiguous, use the approved docs;
  do not silently invent a decision.

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
its implementation deep dive is `docs/UC-02_Deep_Dive.md`. The current
specification gate applies to all additional UC-02 functionality, not just
dashboard work. Follow its owner-decision register and freeze checklist.
`docs/CURRENT_WORK.md` is the short-form handoff state (current milestone,
last commit, next exact task) — read it first when resuming this work.

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
- **Closing a use case includes updating this line**, in the same coherent
  commit that finishes the last piece, or a dedicated `docs: move to UC-0X` commit
  right after. A use case isn't actually closed until this file says so.

## Row-level security is not optional

Any table reachable through an anon-key client (the marketing/public data
layer) is protected by Postgres Row Level Security, not by application
code being careful. This has caused real confusion before, RLS fails
silently, a missing or wrong policy just returns empty results, not an
error, so treat it as a required, tested part of the schema, never an
afterthought.

Rules:

- **Policies ship in the same migration as the table or column they
  protect.** A public-facing table without its RLS policies in the same
  commit is not done, don't add "write the policy later."
- **Every public-facing table needs an automated test that runs as the
  anon role specifically**, not the privileged service connection. The
  test must prove both directions: what anon is allowed to do, and at
  least one thing it's correctly blocked from doing (e.g. reading a draft
  event, or writing to a field it shouldn't touch). A migration without
  this test is not done either.
- **Document each policy next to the field comments already in
  db/schema.ts**, in plain language: what it allows, for which role, and
  why. Someone should be able to read the schema file and understand the
  access rules without reverse-engineering the SQL.
- **If a query using the anon client returns unexpectedly empty, check
  the policy before assuming the data is missing.** This is the most
  common failure mode with RLS, silent, not an error, easy to mistake for
  a data problem when it's actually a permissions one.
