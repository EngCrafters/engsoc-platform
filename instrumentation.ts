/**
 * Next.js instrumentation hook.
 *
 * Runs once when a server instance is bootstrapped.
 *
 * This deliberately does NOT throw when the runtime database credential is
 * missing. A failing instrumentation hook makes Next.js report "Failed to
 * prepare server" and every route — including the sign-in and password-recovery
 * pages, which never touch the database — starts returning 500. That is a worse
 * failure than the one it was meant to prevent: a misconfigured deployment
 * should be loudly diagnosable, not completely unusable.
 *
 * So the credential is reported at startup, in a secret-free line an operator
 * can find in the deployment logs, and the database client itself still fails
 * closed on first real use. A deployment that cannot reach its data cannot
 * serve data; it can still serve the pages that diagnose it.
 *
 * Skipped during `next build`: the build evaluates route modules to collect page
 * data but never connects to the database, and requiring a runtime secret there
 * would make the build non-hermetic — the defect this arrangement fixes.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!process.env.APP_RUNTIME_DATABASE_URL) {
    console.error(
      "runtime_database_configuration_missing: APP_RUNTIME_DATABASE_URL is not set for this environment. Routes that read or write data will fail until it is configured."
    );
  }
}
