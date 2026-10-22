import { defineConfig } from "@playwright/test";
import shared from "./playwright.event.config";
export default defineConfig({
  ...shared,
  testDir: "./tests/admin-flow",
  globalSetup: "./tests/event-flow/setup.ts",
  timeout: 300000,
});
