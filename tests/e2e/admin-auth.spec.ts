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
  await page.goto(
    "/admin/events/00000000-0000-4000-8000-000000000000/registrations"
  );
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
});

test("membership review and ID cards are behind the protected boundary", async ({
  page,
  request,
}) => {
  await page.goto("/admin/membership");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
  await page.goto("/admin/membership/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
  // The ID-card route answers for itself: no session, no document.
  const document = await request.get(
    "/admin/membership/00000000-0000-4000-8000-000000000000/document"
  );
  expect(document.status()).toBe(401);
  expect(document.headers()["cache-control"]).toContain("no-store");
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

test("the reset page offers a fresh link instead of a form without a recovery session", async ({
  page,
}) => {
  await page.goto("/auth/reset");
  await expect(
    page.getByRole("heading", { name: "Reset link unavailable" })
  ).toBeVisible();
  await expect(
    page.getByText("This password-reset link has expired. Request a new one.")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Request a new link" })
  ).toHaveAttribute("href", "/admin/recovery");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("the recovery page explains expired and invalid links", async ({
  page,
}) => {
  await page.goto("/admin/recovery?link=expired");
  await expect(
    page.getByText("This password-reset link has expired. Request a new one.")
  ).toBeVisible();
  await page.goto("/admin/recovery?link=invalid");
  await expect(page.getByText(/invalid or expired/i)).toBeVisible();
});

test("the sign-in page confirms a completed password reset", async ({
  page,
}) => {
  await page.goto("/admin/login?reset=success");
  await expect(
    page.getByText("Your password was updated. Sign in with your new password.")
  ).toBeVisible();
});

test("a recovery session left in the home page URL is removed and never stays visible", async ({
  page,
}) => {
  await page.goto("/#access_token=a.b.c&refresh_token=r&type=recovery");
  // The fake token cannot become a session, so the relay ends on the
  // recovery page; the point is that no token remains in the address bar.
  await expect(page).toHaveURL(/\/admin\/recovery\?link=invalid$/);
  expect(page.url()).not.toContain("access_token");
  expect(page.url()).not.toContain("refresh_token");
});

test("an expired-link error left in the home page URL leads to the recovery page", async ({
  page,
}) => {
  await page.goto(
    "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
  );
  await expect(page).toHaveURL(/\/admin\/recovery\?link=expired$/);
  await expect(
    page.getByText("This password-reset link has expired. Request a new one.")
  ).toBeVisible();
});

test("unrelated URL fragments are left alone on the home page", async ({
  page,
}) => {
  await page.goto("/#upcoming");
  await expect(page).toHaveURL(/\/#upcoming$/);
});

test("the callback never opens the reset page for a bad link", async ({
  page,
}) => {
  await page.goto("/auth/callback?token_hash=not-a-real-hash&type=recovery");
  await expect(page).toHaveURL(/\/admin\/recovery\?link=(invalid|expired)$/);
  await page.goto("/auth/callback?code=not-a-real-code&next=/auth/reset");
  await expect(page).toHaveURL(/\/admin\/recovery\?link=(invalid|expired)$/);
});

test("the Technical user-management route is behind the same protected boundary", async ({
  page,
}) => {
  await page.goto("/admin/access");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
});

test("a malformed event id stays behind the protected boundary", async ({
  page,
}) => {
  await page.goto("/admin/events/not-a-uuid");
  await expect(page).toHaveURL(/\/admin\/login\?next=\/admin\/events$/);
});
