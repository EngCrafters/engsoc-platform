import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest doesn't read .env.local the way Next.js does — load it explicitly
// so tests/rls-staging-anon.test.ts can see STAGING_SUPABASE_URL /
// STAGING_SUPABASE_ANON_KEY. "" as the third arg means "load every var,
// not just VITE_-prefixed ones" — safe here since this only ever runs
// locally or in CI, never bundled into client code.
Object.assign(process.env, loadEnv("", process.cwd(), ""));

export default defineConfig({
  // Component tests render server components to static markup; tsconfig keeps
  // jsx:"preserve" for Next, so tell the test transform to compile it.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // The `server-only` marker is a build-time guard provided by the
      // framework; importing it under Node throws by design. See the stub.
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/stubs/server-only.ts"
      ),
    },
  },
  test: {
    // Hermetic by design: no network, no third-party credentials. The live
    // staging suite lives in tests/integration and is opt-in through
    // `npm run test:integration` (vitest.integration.config.mts).
    exclude: ["tests/e2e/**", "tests/integration/**", "node_modules/**"],
    environment: "node",
    // The database suites share one PostgreSQL container, and some assert
    // global invariants (for example "the last active Technical owner cannot be
    // removed"). Running files one at a time keeps them independent of each
    // other's fixtures.
    fileParallelism: false,
    globalSetup: ["./tests/db/global-setup.ts"],
    // These tests hit the real staging Supabase project over the network
    // (see tests/rls-staging-anon.test.ts) — the default 5s timeout is
    // sometimes too tight for that.
    testTimeout: 30000,
  },
});
