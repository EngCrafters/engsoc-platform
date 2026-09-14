# 0007: Direct-main autonomous development workflow

## Status

Accepted, September 15, 2026.

## Context

The repository originally used feature branches, stacked pull requests, and a
mandatory human review before merge. That process added coordination overhead
now that Codex is the primary technical implementation agent. The project
still needs rigorous validation, secure database changes, and deployment
verification; removing routine PRs must not remove those controls.

The historical Phase 0 team playbook records the former learning and review
model. It is preserved as a historical planning document rather than
rewritten.

## Decision

Routine engineering work follows this sequence directly on `main`:

1. Understand the relevant approved requirements and implementation.
2. Implement the smallest correct change.
3. Validate it, including relevant tests, migration/RLS checks, lint,
   type-check, and production build.
4. Self-review the diff.
5. Create a small, coherent Conventional Commit directly on `main`.
6. Push `main`, inspect GitHub Actions and the Vercel production deployment,
   and repair failures immediately.

Feature branches, stacked PRs, and human merge approval are not routine
requirements. An exceptional PR may still be used for collaboration, but it
is optional and does not replace the direct-main workflow.

## Consequences

- Codex owns normal implementation, validation, delivery, and failure repair.
- GitHub Actions remains required on pushes to `main`; PR-triggered checks may
  remain for exceptional PRs.
- Vercel's GitHub integration remains the sole deployment path. Production is
  deployed from `main`; preview deployments are optional.
- Commits pushed to `main` must use the authorized `EngCrafters` GitHub
  identity. Vercel blocks Git-triggered deployments when a commit author is
  not entitled to deploy for the `Eng_Crafters` team.
- Conventional Commits, hooks, test suites, RLS, secret protection, and
  database migration discipline remain mandatory.
- GitHub protections should allow authorized authenticated direct pushes to
  `main` while retaining compatible protections such as force-push prevention,
  secret scanning, security alerts, and post-push CI.

## Source

Direct instruction from the technical lead, September 15, 2026.
