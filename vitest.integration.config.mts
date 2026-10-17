import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import path from "node:path";

// The live staging suite reads credentials the same way the app does.
Object.assign(process.env, loadEnv("", process.cwd(), ""));

/**
 * Live staging integration suite.
 *
 * Kept in its own config so the default `npm test` stays hermetic: it needs no
 * database container, no network, and no third-party credentials. This one talks
 * to a real Supabase project and is opt-in through `npm run test:integration`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./tests/integration/global-setup.ts"],
    testTimeout: 30000,
  },
});
