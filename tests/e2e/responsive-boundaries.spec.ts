import { expect, test } from "@playwright/test";
import { E2E_EVENTS } from "./fixtures";

test("public and authentication routes fit representative viewport widths", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Viewport matrix runs once.");
  const paths = [
    "/",
    `/events/${E2E_EVENTS.open}`,
    "/admin/login",
    "/admin/recovery",
    "/auth/reset",
  ];
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect
        .poll(
          async () =>
            page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth
            ),
          { message: `${path} at ${width}px must not overflow horizontally` }
        )
        .toBeLessThanOrEqual(1);
    }
  }
});
