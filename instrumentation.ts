/**
 * Next.js instrumentation hook.
 *
 * Runs once when a server instance is bootstrapped. Its only job here is to
 * restore the fail-fast guarantee that `db/index.ts` can no longer provide at
 * module scope: the runtime database credential must be present before the
 * server accepts traffic, so a misconfigured deployment dies at startup rather
 * than on the first query that happens to need data.
 *
 * Deliberately skipped during `next build`. The build evaluates route modules
 * to collect page data but never connects to the database, so requiring a
 * runtime secret there would make the build non-hermetic — which is the defect
 * this arrangement fixes.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertRuntimeDatabaseConfiguration } = await import("./db");
  assertRuntimeDatabaseConfiguration();
}
