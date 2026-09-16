import { expect, test } from "@playwright/test";

test("unauthenticated visitors are redirected to the sign-in boundary", async ({
  page,
}) => {
  await page.goto("/admin/events");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
  await expect(
    page.getByRole("heading", { name: "Committee administration" })
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText(/sign up/i)).toHaveCount(0);
});
