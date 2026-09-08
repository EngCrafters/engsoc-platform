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

- Reference the UC number in commit messages and PR descriptions, e.g.
  `feat(uc-01): add duplicate email check`.
- If you touch `db/schema.ts`, the comment above the changed table should
  already explain which use case it serves, keep that comment accurate.
- Don't add fields, tables, or routes that aren't backed by something in
  the use case doc or a written ADR.

## 5. Definition of done

Each use case's own document defines when it's actually finished (open
decisions resolved, all assigned tasks complete, behavior matches the
diagram). Don't consider a use case done because the code runs, check it
against that list explicitly.

## 6. Working with a Level 1/2 teammate

If you're pairing with Salim, Ibrahim, or Zaher: narrate *why* a piece of
code satisfies a specific step in the main flow or handles a specific
alternate flow, don't just produce working code silently. The goal of each
session is that they could explain the finished piece back to the group,
not just that it works.
