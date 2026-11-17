# Development guide

Recipes that follow the patterns already in the code. Project rules (Conventional Commits,
"the data model is the contract", RLS in the same migration, module READMEs, no invented policy)
are in [`CLAUDE.md`](../../CLAUDE.md) and [`AGENTS.md`](../../AGENTS.md). `AGENTS.md` also warns
that this Next.js version differs from older documentation: read
`node_modules/next/dist/docs/` before relying on a framework API.

## Principles that the code follows

- **The database decides.** Rules that protect data (scope, state transitions, limits, duplicates)
  live in `private.*` routines, re-checked for the live actor. TypeScript validates input and
  shapes output; it is never the only guard.
- **The actor comes from verified identity.** Pass the user ID from `getManagerContext()`,
  `verifyMemberAccessToken()` or nothing (anonymous). Never accept an actor, role or committee from
  a request body (ADR 0015).
- **The wire contract is explicit.** Public responses are mapped field by field (`lib/api/dto.ts`,
  `memberResult`, `projectResult`). Internal codes become a fixed public vocabulary.
- **Errors never leak internals.** No SQL, stack, provider message, token or personal data in
  responses or logs (`lib/api/problems.ts`, `lib/api/log.ts`).
- **One audit row per mutation**, written in the same transaction by the routine.

## Add a public API endpoint

1. **Contract first.** Decide the method, path, auth type, request and response shapes, and error
   codes. Add them to [`docs/api/openapi.v1.yaml`](../api/openapi.v1.yaml) (or the relevant
   `docs/api/*.md`) and to [API reference](../reference/api.md).
2. **Database.** If it reads or writes data, add or extend a routine in a new migration (see
   below) and grant `EXECUTE` to `app_runtime`.
3. **Domain function.** Add a function in `lib/<domain>/` that calls the routine with
   `db.execute(sql\`SELECT private.<routine>(${actor}::uuid, …) AS result\`)` and returns typed
   results. Keep it free of HTTP concerns.
4. **Route handler.** Create `app/v1/<path>/route.ts` with `export const dynamic = "force-dynamic"`,
   then:
   1. `requestIdFrom(request)`;
   2. the CORS policy: `corsHeaders`, `preflight` and an `OPTIONS` export for browser routes. Add
      new methods or headers to the policy;
   3. reject a disallowed `Origin` with `problem("forbidden", …)`;
   4. authenticate: `authenticate(request, scope)` for API keys, or `memberRequest(request)` for
      members;
   5. read the body with `readJsonBody` or `readMultipartBody` (bounded) and reject unexpected
      keys with 422 `unexpected-field`;
   6. call the domain function. Map results with `json(...)` and `problem(...)`, or with
      `memberResult` / `projectResult`;
   7. set `cache-control` deliberately: `no-store` for anything personal.
5. **Rate limits** belong in the routine, keyed on a trusted value: `resolveClientIp()` for
   anonymous callers, the member ID for signed-in callers.
6. **Tests.** Add a route test in `tests/api-*.test.ts` (see `tests/api-routes.test.ts`) and
   database tests in `tests/db/` for the routine's allowed and denied cases.
7. **Website.** If the website will call it from the browser, its origin must be in
   `CORE_API_ALLOWED_ORIGINS`. Coordinate the website change through the
   [integration guide](../integration/system-integration.md#which-repository-changes).

## Add a migration

Follow [Migrations → Adding a migration](migrations.md#adding-a-migration). In short:

- next number and journal entry;
- bump `private.core_schema_version()`;
- forced RLS and policies in the same file;
- `SECURITY DEFINER` routines owned by `uc02_routine_owner`, with `REVOKE … FROM PUBLIC` and
  `GRANT EXECUTE … TO app_runtime`;
- audit actions added to the CHECK list;
- a self-check block;
- database tests.

Never apply it to a hosted database without approval.

## Add a role-sensitive operation

1. **Name the rule** in terms of existing authorities:
   - committee scope (`can_access_committee`, `lock_committee_access`);
   - Senior (`senior_admin_level`);
   - membership reviewer (`membership_reviewer_kind`);
   - project reviewer (`project_reviewer`);
   - Technical only.

   Do not create a new role or infer authority from names or titles. A genuinely new authority
   needs an ADR and an update to [Roles and permissions](../reference/roles-and-permissions.md).

2. **Enforce it in the routine.** Lock the actor's grant (`FOR SHARE`) and the target rows
   (`FOR UPDATE`), re-check state after locking, and refuse self-targeting where it matters.
   Return `FORBIDDEN` without revealing whether the target exists.
3. **Mirror it on the server** for a good user experience:
   - `requireSenior()` or a Technical check in the server action;
   - the Board limits, as in `changeAccessAction` and `createUserAction`.

   The server check is a courtesy; the routine is the guard.

4. **Mirror it in the UI** (navigation, buttons) last. Hiding a control is never the security
   boundary.
5. **Test it.** Add database tests with real roles for each authorized level and at least one
   denied level, plus an action test (see `tests/access-actions.test.ts` and
   `tests/db/administration.test.ts`).

## Add a dashboard feature

1. Add a page under `app/admin/(protected)/<area>/page.tsx`. The layout already guarantees a
   signed-in user with active access. Call `getManagerContext()` or `requireSenior()` again in the
   page; it is cached per request.
2. Read data through a `lib/<area>/server.ts` function that calls a scoped routine. A routine
   returning no row should become `notFound()`, never a hint that the record exists.
3. Put mutations in `actions.ts` with `"use server"`:
   - re-resolve the actor;
   - validate `FormData` strictly (single values, UUID checks, length limits);
   - call the routine;
   - `revalidatePath` on success;
   - return user-safe messages from the area's `messages.ts`.
4. Add navigation in [`components/admin/admin-navigation.ts`](../../components/admin/admin-navigation.ts)
   and the visibility rule in `admin-sidebar.tsx`.
5. Reuse the design system: `components/ui`, `components/admin` page headers, empty and error
   states, confirmation dialogs (ADR 0010, ADR 0011, `docs/DESIGN_SYSTEM.md`).
6. For a file download, use a POST route handler guarded by `isSameOriginPost`, bounded output and
   `private, no-store`, as the CSV exports do.
7. Add or extend a browser suite if the flow matters end to end (`tests/admin-flow`).

## Before you push

Run what CI runs:

```bash
npm run format:check
npm run lint
npm run db:check
npm run typecheck
npm test
npm run build
```

Then update the documents listed in [Documentation maintenance](../maintenance.md).
