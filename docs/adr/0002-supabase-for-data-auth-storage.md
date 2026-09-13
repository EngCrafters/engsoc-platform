# 0002: Supabase for data, auth, and storage

## Status

Accepted

## Context

The platform needs a database, authentication, and file storage. An
earlier version of this decision (ADR-02 and ADR-03 in
`docs/Technical_Blueprint.pdf`) chose Cloudflare D1, R2, and Better Auth
for the same jobs, picked for cost and vendor independence. That reasoning
was sound, but the team weighed it against a more practical concern for how
this specific team works.

## Decision

Use Supabase — hosted Postgres, authentication, and file storage, all in
one project — instead of Cloudflare D1, R2, and Better Auth. This
supersedes the earlier D1/R2/Better Auth decision.

## Consequences

- Supabase has a native MCP server, so Claude (in chat and in Claude Code)
  can inspect the schema, run queries, and manage auth and storage
  directly. For a team that's mostly non-technical and leaning on AI
  assistance, that direct connection is a bigger practical advantage than
  the cost savings and vendor independence Cloudflare offered.
- Supabase's free tier keeps this at effectively no cost at current scale,
  same as the Cloudflare option would have.
- Database, auth, and storage now live in one project instead of three
  separate services, which is one fewer set of credentials and dashboards
  for the team to keep track of.
- Row Level Security is how role-based access (NFR-03) gets enforced at the
  database layer — policies are written per table as those access rules
  get defined, not assumed up front.

## Source

`docs/Technical_Blueprint.pdf`, Part 1 — ADR-06 (supersedes ADR-02, ADR-03).
