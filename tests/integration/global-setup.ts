import { PRODUCTION_PROJECT_REF } from "../../scripts/lib/supabase-target.mjs";

/**
 * Fail fast for an explicitly invoked integration run.
 *
 * The default suite never collects `tests/integration` (vitest.config.mts
 * excludes it), so a missing credential cannot break ordinary development.
 * Running `npm run test:integration` is a deliberate act, though, and a green
 * run full of silent skips would be a lie. So this setup refuses to start
 * without a staging target, and refuses outright if the target is production.
 */
export default function globalSetup() {
  const url = process.env.STAGING_SUPABASE_URL;
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "The staging integration suite needs STAGING_SUPABASE_URL and STAGING_SUPABASE_ANON_KEY. Set them in .env.local (see .env.example) or in the CI environment, then re-run npm run test:integration."
    );
  }

  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/i.exec(
    url.trim()
  )?.[1];
  if (!ref) {
    throw new Error(
      "STAGING_SUPABASE_URL does not identify a Supabase project ref; refusing to run against an unknown target."
    );
  }
  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(
      "STAGING_SUPABASE_URL points at the production project. The integration suite must never run against production."
    );
  }
}
