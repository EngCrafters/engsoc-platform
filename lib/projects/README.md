# Member projects

ADR 0021 owns the data and review contract; migration 0029 supplies all authorization,
locks, snapshots and append-only notifications. `content.ts` validates the design DTO,
`server.ts` calls restricted routines, API handlers verify existing member JWTs.
The dashboard uses the existing manager context and rechecks grants in PostgreSQL.
No direct table access or alternate account lifecycle is introduced.
