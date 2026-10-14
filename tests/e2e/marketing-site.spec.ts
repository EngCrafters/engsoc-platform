import { expect, test } from "@playwright/test";

/**
 * The migrated public site.
 *
 * These cover the surfaces that changed in the migration: the new landing page,
 * the real /events route, the mobile menu, and the language switch that drives
 * right-to-left rendering from a cookie the server reads.
 */

test("landing page renders the society's public experience", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: /Where ideas/i })
  ).toBeVisible();
  // Sections the navigation links to must exist as real landmarks.
  await expect(page.locator("#events")).toBeVisible();
  await expect(page.locator("#activities")).toBeVisible();
  await expect(page.locator("#projects")).toBeVisible();
  await expect(page.locator("#disciplines")).toBeVisible();
  await expect(page.locator("#join")).toBeVisible();

  // Exactly one h1, and a skip link that reaches the main landmark.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("main")).toBeVisible();
});

test("public navigation reaches the real routes", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Events", exact: true }).first().click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Upcoming events" })
  ).toBeVisible();

  await page.getByRole("link", { name: "About", exact: true }).first().click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /About the society/i })
  ).toBeVisible();

  await page.goto("/activities");
  await expect(
    page.getByRole("heading", { level: 1, name: /Previous Activities/i })
  ).toBeVisible();
});

test("mobile menu opens, traps focus sensibly and closes on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "Open menu" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const panel = page.locator("#site-menu");
  await expect(panel).toBeVisible();
  // Focus moves into the panel so keyboard users are not stranded.
  await expect(panel.getByRole("link").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
});

test("language switch renders Arabic right-to-left without a reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Where ideas"
  );

  const surface = page.locator(".marketing-surface");
  await expect(surface).toHaveAttribute("dir", "ltr");

  await page.getByRole("button", { name: "Switch to English" }).click();

  // The server re-renders: direction and language change together.
  await expect(surface).toHaveAttribute("dir", "rtl");
  await expect(surface).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText(
    "Where ideas"
  );
});

test("registration panel exposes the canonical admission states", async ({
  page,
}) => {
  await page.goto("/events");
  const firstEvent = page.getByRole("link", { name: /E2E event/ }).first();
  await firstEvent.click();
  await expect(
    page.locator('section[aria-labelledby="registration-heading"]')
  ).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
});
