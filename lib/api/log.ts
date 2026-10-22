/** SQLSTATEs meaning the database is older than this code (missing routine, table, column or type). */
const SCHEMA_MISMATCH = new Set(["42883", "42P01", "42703", "42704"]);

/**
 * Logs a server-side failure for operators: the error class and Postgres
 * SQLSTATE only. Never the message, which can quote row values, and never
 * request contents. Drizzle wraps driver errors, so the cause is unwrapped.
 */
export function logServerError(
  event: string,
  error: unknown,
  requestId?: string
) {
  const outer = error as { name?: unknown; cause?: unknown } | null;
  const inner = (
    outer?.cause && typeof outer.cause === "object" ? outer.cause : outer
  ) as { name?: unknown; code?: unknown } | null;
  const code = typeof inner?.code === "string" ? inner.code : undefined;
  console.error(event, {
    ...(requestId ? { requestId } : {}),
    name: typeof inner?.name === "string" ? inner.name : typeof error,
    ...(code ? { code } : {}),
    ...(code && SCHEMA_MISMATCH.has(code) ? { schemaMismatch: true } : {}),
  });
}
