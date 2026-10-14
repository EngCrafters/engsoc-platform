/**
 * Target guard for operator scripts that can reach a real Supabase project.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Supabase CLI resolves `--linked` from `supabase/.temp/project-ref`, and in
 * a normal developer checkout that file points at the PRODUCTION project. A
 * script whose write statements are aimed at staging but whose connection is
 * resolved implicitly therefore lands on production. That is exactly the shape
 * the M7 browser smoke script had before it was removed.
 *
 * The rule this module enforces is structural, not advisory:
 *
 *   - a script that can write MUST name its project ref explicitly, and
 *   - that ref MUST NOT be the production ref, and
 *   - the ref is derived from the connection identity, never from a comment,
 *     an environment-variable name, or operator memory.
 *
 * Deliberately dependency-free so it can be unit tested without a database.
 */

/** The main/production project. Never a valid target for an operator script. */
export const PRODUCTION_PROJECT_REF = "rbeyqrfypowyocmnmvwu";

/** The UC-02 staging project. The only project operator scripts may target. */
export const STAGING_PROJECT_REF = "wnrdgnmmcdedmilnzzsl";

/**
 * Extract the Supabase project ref encoded in a Postgres connection string.
 *
 * Supabase exposes two shapes and both are supported:
 *   direct:  postgres://postgres.<ref>@db.<ref>.supabase.co:5432/postgres
 *   pooled:  postgres://postgres.<ref>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Returns `null` when the string is not a Supabase connection string, so callers
 * fail closed rather than silently accepting an unknown host.
 */
export function projectRefFromConnectionString(connectionString) {
  let target;
  try {
    target = new URL(connectionString);
  } catch {
    return null;
  }
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(target.hostname);
  if (direct) return direct[1];
  if (/\.pooler\.supabase\.com$/i.test(target.hostname)) {
    const pooled = /\.([a-z0-9]+)$/i.exec(decodeURIComponent(target.username));
    if (pooled) return pooled[1];
  }
  return null;
}

/**
 * Assert that a connection string targets an explicitly named project ref, and
 * that the ref is not production.
 *
 * `explicitRef` is required. Passing `undefined` means the caller did not name a
 * target, which is treated as a hard failure: implicit targeting is the bug this
 * guard exists to prevent.
 */
export function assertOperatorScriptTarget(connectionString, explicitRef) {
  if (!explicitRef) {
    throw new Error(
      "Operator scripts must name their target project ref explicitly; implicit targeting is not allowed."
    );
  }
  if (explicitRef === PRODUCTION_PROJECT_REF) {
    throw new Error(
      "Refusing to run an operator script against the production project."
    );
  }
  const actual = projectRefFromConnectionString(connectionString);
  if (!actual) {
    throw new Error(
      "Connection string does not identify a Supabase project ref; refusing to continue."
    );
  }
  if (actual !== explicitRef) {
    throw new Error(
      `Connection targets project ${actual} but the script declared ${explicitRef}; refusing to continue.`
    );
  }
  return actual;
}

/**
 * Production verification scripts must name the production project on purpose.
 * A production check that silently ran against staging would report a
 * meaningless pass.
 */
export function assertProductionProjectTarget(connectionString, explicitRef) {
  if (explicitRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      "Production verification scripts must name the production project ref explicitly."
    );
  }
  const actual = projectRefFromConnectionString(connectionString);
  if (actual !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      "This verification script is restricted to the production project; refusing to continue."
    );
  }
  return actual;
}

/**
 * Assert a Supabase CLI db-query style invocation is not relying on --linked.
 * Kept separate so the rule is testable even though no script uses it today.
 */
export function assertNoImplicitLinkedTarget(args) {
  if (args.includes("--linked")) {
    throw new Error(
      "--linked resolves to whatever supabase/.temp/project-ref holds, which is the production project in a normal checkout; pass --project-ref instead."
    );
  }
  return true;
}
