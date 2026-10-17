import { expect, test } from "@playwright/test";
import { E2E_EVENTS } from "./fixtures";

test("catalog separates upcoming/past events and paginates", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Upcoming events" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open E2E event" })
  ).toBeVisible();
  await expect(page.getByText("Past E2E event")).toHaveCount(0);
  await page.getByRole("link", { name: /More upcoming events/ }).click();
  await expect(page.getByText("Paged E2E event 21")).toBeVisible();
  await page.getByRole("link", { name: "Past events" }).click();
  await expect(
    page.getByRole("heading", { name: "Past events" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Past E2E event" })
  ).toBeVisible();
});

test("public detail has safe metadata and appropriate admission controls", async ({
  page,
}) => {
  await page.goto(`/events/${E2E_EVENTS.open}`);
  await expect(
    page.getByRole("heading", { name: "Open E2E event" })
  ).toBeVisible();
  await expect(page.getByText("E2E Committee")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Register" })).toBeVisible();
  await page.goto(`/events/${E2E_EVENTS.full}`);
  await expect(
    page.getByRole("button", { name: "Join waitlist" })
  ).toBeVisible();
  await page.goto(`/events/${E2E_EVENTS.past}`);
  await expect(
    page.getByRole("button", { name: "Registration closed" })
  ).toBeDisabled();
  await page.goto(`/events/${E2E_EVENTS.draft}`);
  await expect(page.getByText("404")).toBeVisible();
});

// Next.js injects its own route-announcer element (role="alert", outside
// the page content) for accessibility route-change announcements. Scoping
// to the registration region avoids ambiguously matching it.
function registrationRegion(page: import("@playwright/test").Page) {
  return page.getByRole("region");
}

test("anonymous registration validates, focuses errors, succeeds, and retries safely", async ({
  page,
}, testInfo) => {
  // Desktop and mobile projects share one database — a project-unique email
  // keeps this test isolated from the same spec running under the other
  // project against the identical fixture event.
  const email = `visitor-${testInfo.project.name}@example.test`;
  await page.goto(`/events/${E2E_EVENTS.open}`);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(registrationRegion(page).getByRole("alert")).toBeFocused();
  await page.getByLabel("Name").fill("E2E visitor");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(registrationRegion(page).getByRole("status")).toContainText(
    "place is confirmed"
  );
  await page.goto(`/events/${E2E_EVENTS.open}`);
  await page.getByLabel("Name").fill("E2E visitor");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(registrationRegion(page).getByRole("alert")).toContainText(
    "already registered"
  );
});

test("numerically full event offers waitlist and confirms a waitlisted place", async ({
  page,
}, testInfo) => {
  const email = `waitlisted-${testInfo.project.name}@example.test`;
  await page.goto(`/events/${E2E_EVENTS.waitlist}`);
  await expect(
    page.getByRole("button", { name: "Join waitlist" })
  ).toBeVisible();
  await page.getByLabel("Name").fill("Waitlisted visitor");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(registrationRegion(page).getByRole("status")).toContainText(
    "on the waitlist"
  );
});
