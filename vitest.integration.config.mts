import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Configuration for the LIVE integration suites under tests/integration/.
//
// They are deliberately excluded from the default `npm test` run: they talk to
// a real remote Supabase project over the network, so they are not hermetic and
// must not be able to fail an ordinary local run. `npm test` covers everything
// a fresh clone can execute on its own.
//
// There is no database globalSetup here on purpose — these suites need a
// network and a credential, never a local PostgreSQL container.
//
// `""` as the third arg means "load every var, not just VITE_-prefixed ones";
// safe because this only ever runs locally or in CI, never in client code.
Object.assign(process.env, loadEnv("", process.cwd(), ""));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // These hit the real staging project over the network; the default 5s
    // timeout is sometimes too tight for that.
    testTimeout: 30000,
  },
});
