import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest doesn't read .env.local the way Next.js does — load it explicitly
// so tests/rls-staging-anon.test.ts can see STAGING_SUPABASE_URL /
// STAGING_SUPABASE_ANON_KEY. Only those opt-in staging test variables are
// taken: a developer's runtime settings (allowed origins, Storage keys, the
// runtime database URL) must never change what the hermetic suite tests or
// connect it to a real project.
const localEnv = loadEnv("", process.cwd(), "");
for (const [name, value] of Object.entries(localEnv)) {
  if (/^STAGING_|^RUN_STAGING_/.test(name)) process.env[name] = value;
}

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
    exclude: [
      "tests/e2e/**",
      "tests/event-flow/**",
      "tests/project-flow/**",
      "tests/integration/**",
      "node_modules/**",
    ],
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
