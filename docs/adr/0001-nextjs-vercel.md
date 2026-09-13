# 0001: Next.js on Vercel

## Status

Accepted

## Context

The platform needs a member-facing site and forms. An earlier version of
this decision (ADR-01 in `docs/Technical_Blueprint.pdf`) chose Cloudflare
Pages for the same job, picked for cost and independence from any single
vendor. That reasoning was sound for what it optimized for, but it was
superseded once the team weighed a different priority: this is a small,
mostly non-technical team leaning on AI assistance to build and maintain
the platform.

## Decision

Build the member-facing site and forms in Next.js (App Router), deployed on
Vercel. This supersedes the earlier Cloudflare Pages decision.

## Consequences

- Vercel is built by the same team as Next.js, so deployment, previews, and
  framework updates stay friction-free — there's no separate platform team
  to keep in sync with framework releases.
- Vercel's free tier comfortably covers a society-sized platform, so this
  costs nothing at current scale.
- Deployment runs through Vercel's own GitHub integration (auto-deploy on
  push to `main`, preview deploys on PRs) — no custom CI/CD pipeline to
  build or maintain alongside it.
- The Cloudflare option isn't gone for good. If the team outgrows Vercel's
  free tier or needs something Vercel can't do, that door stays open — see
  `docs/Technical_Blueprint.pdf`, Part 1.

## Source

`docs/Technical_Blueprint.pdf`, Part 1 — ADR-05 (supersedes ADR-01).
