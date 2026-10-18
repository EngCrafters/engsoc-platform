import {
  STAGING_PROJECT_REF,
  assertOperatorScriptTarget,
} from "./supabase-target.mjs";

export const STAGING_CORE_ORIGIN =
  "https://engsoc-platform-git-staging-eng-crafters.vercel.app";

/** Fail before either HTTP requests or fixture writes. No inferred target. */
export function assertStagingHttpTarget(env) {
  if (env.STAGING_PROJECT_REF !== STAGING_PROJECT_REF) {
    throw new Error(
      "HTTP E2E requires the exact explicit staging project ref."
    );
  }
  let url;
  try {
    url = new URL(env.CORE_HTTP_E2E_URL);
  } catch {
    throw new Error("HTTP E2E requires an explicit staging deployment URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== STAGING_CORE_ORIGIN ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !["/", ""].includes(url.pathname)
  ) {
    throw new Error("HTTP E2E requires the pinned Core staging branch origin.");
  }
  assertOperatorScriptTarget(env.APP_RUNTIME_DATABASE_URL, STAGING_PROJECT_REF);
  const username = decodeURIComponent(
    new URL(env.APP_RUNTIME_DATABASE_URL).username
  );
  if (
    !["app_runtime", `app_runtime.${STAGING_PROJECT_REF}`].includes(username)
  ) {
    throw new Error(
      "HTTP E2E requires a staging app_runtime identity, never a superuser runtime."
    );
  }
  for (const name of ["CORE_HTTP_E2E_READ_KEY", "CORE_HTTP_E2E_NO_SCOPE_KEY"]) {
    if (
      !/^essq_test_[a-z0-9_]{8,40}_[A-Za-z0-9_-]{32,}$/.test(env[name] ?? "")
    ) {
      throw new Error("HTTP E2E requires staging-only API client keys.");
    }
  }
  if (env.CORE_HTTP_E2E_READ_KEY === env.CORE_HTTP_E2E_NO_SCOPE_KEY) {
    throw new Error("HTTP E2E needs distinct read and no-scope clients.");
  }
  return url.origin;
}
