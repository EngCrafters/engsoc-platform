import { expect, test } from "@playwright/test";

// Dashboard forms are Server Actions. A click that lands before the page's JavaScript is ready
// submits the form natively; under a `no-referrer` policy the browser then sends `Origin: null` and
// Next.js refuses the action ("Invalid Server Actions request"), so the sign-in or save does
// nothing. With JavaScript disabled every submission is native, which makes that case
// deterministic: the dashboard (same-origin referrer policy) must still sign in, while public
// pages keep `no-referrer`.
const CORE = "http://127.0.0.1:3600";
const password = "Synthetic-test-password-42!";

test("dashboard forms work as native submissions; public pages keep no-referrer", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${CORE}/admin/login`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "same-origin"
    );
    await page
      .getByLabel("Email address", { exact: true })
      .fill("board-admin@example.test");
    await page.getByLabel("Password", { exact: true }).fill(password);
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/admin/login"
    );
    // Enter in the password field: the browser's own (native) form submission.
    await page.getByLabel("Password", { exact: true }).press("Enter");
    const response = await posted;
    // The action ran: the browser sent the real Origin, not `null`.
    expect(response.request().headers()["origin"]).toBe(CORE);
    await page.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
    expect(new URL(page.url()).pathname.startsWith("/admin")).toBe(true);

    // Public pages are unchanged: no referrer, sent to anyone.
    await page.goto(`${CORE}/`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer"
    );
  } finally {
    await context.close();
  }
});
