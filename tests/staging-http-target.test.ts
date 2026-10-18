import { describe, expect, it } from "vitest";
import { assertStagingHttpTarget } from "../scripts/lib/staging-http-target.mjs";

const env = {
  STAGING_PROJECT_REF: "wnrdgnmmcdedmilnzzsl",
  CORE_HTTP_E2E_URL:
    "https://engsoc-platform-git-staging-eng-crafters.vercel.app",
  APP_RUNTIME_DATABASE_URL:
    "postgres://app_runtime.wnrdgnmmcdedmilnzzsl:fake@aws-0-test.pooler.supabase.com:6543/postgres",
  CORE_HTTP_E2E_READ_KEY: "essq_test_readfixture_" + "a".repeat(43),
  CORE_HTTP_E2E_NO_SCOPE_KEY: "essq_test_scopefixture_" + "b".repeat(43),
};

describe("live staging HTTP E2E target gate", () => {
  it("accepts only the explicit staging preview and runtime identity", () => {
    expect(assertStagingHttpTarget(env)).toBe(env.CORE_HTTP_E2E_URL);
  });
  it.each([
    { STAGING_PROJECT_REF: undefined },
    { STAGING_PROJECT_REF: "rbeyqrfypowyocmnmvwu" },
    { CORE_HTTP_E2E_URL: "https://api.essqu.com" },
    { CORE_HTTP_E2E_URL: "https://engsoc-platform.vercel.app" },
    {
      CORE_HTTP_E2E_URL:
        "https://engsoc-platform-git-main-eng-crafters.vercel.app",
    },
    {
      CORE_HTTP_E2E_URL: "https://engsoc-platform-test.vercel.app.evil.example",
    },
    { CORE_HTTP_E2E_URL: "https://engsoc-platform-test.vercel.app/v1" },
    { CORE_HTTP_E2E_URL: "http://engsoc-platform-test.vercel.app" },
    {
      APP_RUNTIME_DATABASE_URL: env.APP_RUNTIME_DATABASE_URL.replace(
        "app_runtime",
        "postgres"
      ),
    },
    {
      APP_RUNTIME_DATABASE_URL: env.APP_RUNTIME_DATABASE_URL.replace(
        "wnrdgnmmcdedmilnzzsl",
        "rbeyqrfypowyocmnmvwu"
      ),
    },
    {
      CORE_HTTP_E2E_READ_KEY: env.CORE_HTTP_E2E_READ_KEY.replace(
        "test",
        "live"
      ),
    },
    { CORE_HTTP_E2E_NO_SCOPE_KEY: env.CORE_HTTP_E2E_READ_KEY },
  ])("refuses unsafe or implicit target %j", (override) => {
    expect(() => assertStagingHttpTarget({ ...env, ...override })).toThrow();
  });
});
