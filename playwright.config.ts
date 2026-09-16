import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  // Desktop and mobile share one dev server and one database fixture set —
  // running them concurrently causes Turbopack cold-compile contention and
  // races on shared registration fixtures (e.g. both projects registering
  // the same email at once). Sequential execution is what makes this suite
  // actually deterministic.
  workers: 1,
  // Next.js dev/Turbopack compiles each route (and each distinct search-param
  // variant) on first hit — a fresh /?period=past or /events/[id] navigation
  // can take longer than the 5s default assertion timeout to finish
  // rendering, independent of application correctness.
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  // The app runs as a production build (NODE_ENV=production) here, so
  // app/(marketing)/actions.ts's getClientIp trusts only
  // x-vercel-forwarded-for, exactly as it would behind real Vercel —
  // simulate that header rather than weakening the app for tests. Each
  // project gets its own simulated IP: the registration rate limit
  // (5 attempts/10min) is per-IP, and both projects run against the same
  // shared database, so a single shared IP would trip it across projects.
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        extraHTTPHeaders: { "x-vercel-forwarded-for": "203.0.113.10" },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        extraHTTPHeaders: { "x-vercel-forwarded-for": "203.0.113.20" },
      },
    },
  ],
});
