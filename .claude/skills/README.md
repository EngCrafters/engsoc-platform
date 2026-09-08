# Skills in this project

`implement-use-case/` is the first skill: it governs how any UC-numbered
feature gets built. When you add more skills, e.g. for UI/design conventions,
testing, or a specific domain, follow the same shape:

```
.claude/skills/<skill-name>/SKILL.md
```

Each `SKILL.md` needs a frontmatter block:

```markdown
---
name: skill-name
description: One or two sentences on what this covers and when to use it,
  specific enough that Claude picks it correctly without you having to
  mention it by name every time.
---
```

## Ground rules for new skills

- **Point to `docs/`, don't repeat it.** The four governing PDFs are the
  source of truth for the idea, requirements, architecture, and current use
  case. A new skill should reference them, not restate them, restating
  invites drift when a doc gets updated and the skill doesn't.
- **Stay specific to this project.** General good practice (accessibility,
  responsive design, whatever the new skill covers) belongs in the skill.
  Project-specific facts (our stack, our data model, our team) belong in
  `CLAUDE.md`, or get referenced from it.
- **One concern per skill.** `implement-use-case` is about process, not UI.
  A future `ui-design` skill should be about visual and interaction
  conventions, not repeat the use-case workflow. Keep them separable so
  updating one doesn't require touching the other.

## Likely next skills

- **UI/design**: visual language, component conventions, how a use case's
  workflow diagram maps to actual screens.
- **Testing**: how Zaher's manual walkthroughs (see
  `docs/UC-01_Deep_Dive.pdf`, Part 4) relate to any automated tests added
  later.
