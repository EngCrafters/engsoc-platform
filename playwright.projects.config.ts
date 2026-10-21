import { defineConfig } from "@playwright/test";
import shared from "./playwright.event.config";
export default defineConfig({
  ...shared,
  testDir: "./tests/project-flow",
  globalSetup: "./tests/event-flow/setup.ts",
  timeout: 180000,
});
