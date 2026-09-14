---
name: implement-use-case
description: Use this whenever building, reviewing, or discussing a UC-numbered use case (UC-01 through UC-07) for the Engineering Society platform. Covers how to read the use case docs, what order to build in, and how to keep changes traceable back to the approved requirements.
---

# Implementing a use case

This project builds one approved use case at a time, as a whole team, not by
splitting features across people working in isolation. Follow this process
whenever a UC number comes up.

## 1. Read before writing any code

Every use case has two documents:

- `/docs/Idea_and_Requirements_Document.pdf` — the formal spec: actors,
  precondition, trigger, main flow, alternate/exception flow, postcondition.
- A deep-dive doc if one exists for the current use case (e.g.
  `/docs/UC-01_Deep_Dive.pdf`) — field-by-field rules, every real-world
  situation, and open decisions that are NOT yet resolved.

**Check for open decisions first.** If a deep-dive doc marks something as an
open decision, do not silently pick an answer and code it. Flag it back to
Hisham. Coding around an unresolved decision is how the schema ends up
needing to change later.

## 2. Match the main flow, step for step

The main flow in the use case doc is the happy path. Implement it in the
same order it's written. If your implementation needs to diverge from the
documented flow, that's a real design conversation, not a small liberty,
say so explicitly rather than quietly building it differently.

## 3. Handle the alternate/exception flows, don't skip them

Every use case lists what happens when something goes wrong (duplicate
found, invalid input, and so on). These aren't optional extras, they're
part of the definition of done. A use case that only handles the happy path
is not finished.

## 4. Keep changes traceable

- Reference the UC number in commit messages, e.g.
  `feat(uc-01): add duplicate email check`. Include it in an exceptional PR
  description when a PR is actually used.
- If you touch `db/schema.ts`, the comment above the changed table should
  already explain which use case it serves, keep that comment accurate.
- Don't add fields, tables, or routes that aren't backed by something in
  the use case doc or a written ADR.

## 5. Definition of done

Each use case's own document defines when it's actually finished (open
decisions resolved, all assigned tasks complete, behavior matches the
diagram). Don't consider a use case done because the code runs, check it
against that list explicitly.

## 6. If this use case touches a public-facing table, RLS is part of done

Any table reachable through the anon-key client (see CLAUDE.md's "Row-level
security is not optional") needs its policies written and tested in the
same piece of work, not as a follow-up:

- Write the RLS policy alongside the migration, same commit.
- Write an automated test that runs as the anon role, proving what it can
  and correctly cannot do, not just testing against the privileged
  connection.
- If a query unexpectedly returns empty during testing, check the policy
  first, this is RLS's most common failure mode, not a sign the migration
  itself is broken.

A use case with a public-facing table is not finished until this exists,
regardless of whether the feature "works" when tested with privileged
access.
