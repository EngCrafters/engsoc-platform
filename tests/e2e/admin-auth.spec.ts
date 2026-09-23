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

test("all event-management routes remain behind the same protected boundary", async ({
  page,
}) => {
  await page.goto("/admin/events/new");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
  await page.goto("/admin/events/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
});

test("the account page is behind the same protected boundary", async ({
  page,
}) => {
  await page.goto("/admin/account");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
  await expect(page.getByTestId("account-email")).toHaveCount(0);
});

test("recovery explains it changes the password only, without account-existence hints", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await expect(page.getByText(/no self-signup/i)).toBeVisible();
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/admin\/recovery$/);
  await expect(
    page.getByRole("heading", { name: "Reset your password" })
  ).toBeVisible();
  await expect(
    page.getByText(/does not create an account or\s+change which committees/i)
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in" })
  ).toBeVisible();
});

test("the reset page states that committee access is unchanged", async ({
  page,
}) => {
  await page.goto("/auth/reset");
  await expect(
    page.getByRole("heading", { name: "Choose a new password" })
  ).toBeVisible();
  await expect(
    page.getByText(/committee access stays exactly as it was/i)
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("a malformed event id stays behind the protected boundary", async ({
  page,
}) => {
  await page.goto("/admin/events/not-a-uuid");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
});
