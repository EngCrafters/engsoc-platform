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
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    globalSetup: ["./tests/db/global-setup.ts"],
    // These tests hit the real staging Supabase project over the network
    // (see tests/rls-staging-anon.test.ts) — the default 5s timeout is
    // sometimes too tight for that.
    testTimeout: 30000,
  },
});
