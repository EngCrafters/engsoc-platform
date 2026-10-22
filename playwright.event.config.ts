import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/event-flow",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  globalSetup: "./tests/event-flow/setup.ts",
  use: {
    channel: process.env.EVENT_FLOW_BROWSER_CHANNEL,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 850 },
  },
});
