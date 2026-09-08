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
- Phase 1 (Registration) is next: UC-01 (member registration) and UC-02
  (website event announcement + registration).
- We are working **one use case at a time, as a whole team**, not in
  separate lanes. Right now that's UC-01. Don't start UC-02 work until
  UC-01's definition of done is met, see `/docs/UC-01_Deep_Dive.pdf`, Part 5.

## The team

- **Hisham**: technical lead, reviews everything before it merges.
- **Salim, Ibrahim, Zaher**: learning the stack, mostly non-technical.
  They are at Level 1: small, safe, AI-assisted tasks. Nothing they build
  goes to production without Hisham's review.

If you (Claude Code) are being used by Salim, Ibrahim, or Zaher: favor small,
well-explained changes over large ones. Explain *why*, not just *what*, in
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

`db/schema.ts` is the full, current schema. It is a direct implementation of
the ER diagram in `/docs/Technical_Blueprint.pdf`, Part 2. Read the comments
at the top of that file before changing it, they explain which tables are
active now versus reserved for a later phase.

**Never add a column or table that isn't backed by a written decision.** If
a feature needs new data, that's a new entry in the ER diagram and a short
ADR note first, then a schema change. Not the other way around.

## Standards

- Git: feature branches, [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`).
- One review from Hisham before merging to `main`, no exceptions while the
  team is at Level 1–2.
- Every module/feature gets a short `README.md` in its folder: what it does,
  how it connects to the rest of the system.
- Separate environments: never run migrations or seed data against
  production.
- Role-based access: a committee can only manage its own events and data.

## Use cases

All seven live in `/docs/Idea_and_Requirements_Document.pdf`. Each has
actors, precondition, trigger, main flow, alternate/exception flow, and
postcondition, plus a workflow diagram. When implementing a use case, match
its main flow step for step. If the real behavior needs to differ from the
document, that's a conversation with Hisham and a document update, not a
silent code change.

Currently active: **UC-01, Member registration & profile.** Full breakdown,
every field, every edge case, and the three first jobs for Salim, Ibrahim,
and Zaher: `/docs/UC-01_Deep_Dive.pdf`.
