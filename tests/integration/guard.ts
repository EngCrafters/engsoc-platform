/**
 * Configuration guard for the live staging integration suite.
 *
 * This suite talks to a real Supabase project over the network. It must never
 * run as part of `npm test`, and it must never be capable of pointing at
 * production. Both rules are enforced here rather than left to discipline:
 *
 *  - the suite is only collected by `vitest.integration.config.mts`, which
 *    `npm run test:integration` uses;
 *  - if credentials are absent the tests skip with one clear message instead of
 *    failing to load the file;
 *  - if the configured project ref is production, every test is skipped and the
 *    reason says so, so a misconfigured environment cannot silently read or
 *    write the live society database.
 */

import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from "../../scripts/lib/supabase-target.mjs";

export const stagingUrl = process.env.STAGING_SUPABASE_URL;
export const stagingAnonKey = process.env.STAGING_SUPABASE_ANON_KEY;

/** Supabase project ref encoded in a project URL, e.g. https://<ref>.supabase.co */
export function projectRefFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/i.exec(
    value.trim()
  );
  return match ? match[1] : null;
}

export const configured = Boolean(stagingUrl && stagingAnonKey);
export const configuredRef = projectRefFromUrl(stagingUrl);
export const targetsProduction = configuredRef === PRODUCTION_PROJECT_REF;
export const targetsStaging = configuredRef === STAGING_PROJECT_REF;

/**
 * True only when the suite is safe to run: credentials are present AND the
 * target is the known staging project. Anything else — unset, unknown, or
 * production — means "do not run".
 */
export const hasStagingCredentials =
  configured && !targetsProduction && Boolean(configuredRef);

export const skipReason = !configured
  ? "STAGING_SUPABASE_URL and STAGING_SUPABASE_ANON_KEY must be set to run the staging integration suite — see .env.example."
  : targetsProduction
    ? "Refusing to run the staging integration suite against the production project."
    : !configuredRef
      ? "STAGING_SUPABASE_URL does not identify a Supabase project ref; refusing to run."
      : "";

if (targetsProduction) {
  // Loud, once, at collection time. The individual suites also skip, so the run
  // reports the refusal rather than an unexplained pile of skipped tests.
  console.warn(
    "\n[integration] REFUSED: STAGING_SUPABASE_URL points at the production project. No integration test will run.\n"
  );
}
