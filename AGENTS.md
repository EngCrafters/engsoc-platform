<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Engineering Society Platform

`CLAUDE.md` and the approved documents in `docs/` provide the project
context; `docs/adr/0007-direct-main-development-workflow.md` is the current
engineering-workflow decision.

- Work directly on `main`. Codex owns the routine lifecycle: understand,
  implement, validate, self-review, commit, push, inspect CI and production
  deployment, and repair failures. Do not routinely create branches or PRs
  and do not wait for routine human approval.
- Before every meaningful push, review the diff and run the relevant lint,
  type-check, tests (including database/RLS tests where applicable), migration
  validation, and production build. Use small Conventional Commits.
- Preserve documented product decisions. Do not invent unresolved business or
  security policy, weaken RLS, bypass tests, or expose secrets.
- Keep deployment on Vercel's GitHub integration: a push to `main` is the
  production delivery path. Verify both GitHub Actions and Vercel afterwards.
