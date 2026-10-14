import { expect, test } from "@playwright/test";

/**
 * The public site must not advertise the administration sign-in.
 *
 * This is discoverability, not authorization. /admin/login still exists and is
 * still protected by the platform's Auth architecture; the point is only that a
 * visitor browsing the public site is never handed a link to it. Hiding a link
 * protects nothing on its own, which is why the last two tests here check that
 * the route and its guards still behave exactly as before.
 *
 * The check reads the rendered DOM rather than what is visible, so a link
 * hidden with CSS would still fail it: an anchor that ships to the browser has
 * shipped, whether or not it is on screen.
 */

async function adminDestinations(page: import("@playwright/test").Page) {
  return page
    .locator("a[href]")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("href") ?? "")
        .filter((href) => href === "/admin" || href.startsWith("/admin/"))
    );
}

const PUBLIC_PAGES = ["/", "/about", "/activities", "/events"] as const;

for (const path of PUBLIC_PAGES) {
  test(`${path} renders no link to the administration area`, async ({
    page,
  }) => {
    await page.goto(path);
    await page.getByRole("main").waitFor();
    expect(await adminDestinations(page)).toEqual([]);
  });
}

test("the footer of every public page is free of an administration link", async ({
  page,
}) => {
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    await footer.waitFor();
    const hrefs = await footer
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements
          .map((element) => element.getAttribute("href") ?? "")
          .filter((href) => href === "/admin" || href.startsWith("/admin/"))
      );
    expect(hrefs, `footer of ${path}`).toEqual([]);
  }
});

test("the mobile menu opens without an administration entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "Open menu" });
  await toggle.click();
  const panel = page.locator("#site-menu");
  await expect(panel).toBeVisible();

  // The panel is where a sign-in link would most plausibly have been kept.
  const hrefs = await panel
    .locator("a[href]")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("href") ?? "")
        .filter((href) => href === "/admin" || href.startsWith("/admin/"))
    );
  expect(hrefs).toEqual([]);
  await expect(panel.getByRole("link", { name: /sign in/i })).toHaveCount(0);
});

test("the sign-in route itself still works, and is still not indexed", async ({
  page,
}) => {
  const response = await page.goto("/admin/login");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Committee administration" })
  ).toBeVisible();
  // Reachable directly by an administrator, kept out of search results.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/
  );
});

test("a protected page still redirects a signed-out visitor to sign in", async ({
  page,
}) => {
  await page.goto("/admin/access");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(
    page.getByRole("heading", { name: "Committee administration" })
  ).toBeVisible();
});

test("recovery and reset are reachable directly and kept out of search results", async ({
  page,
}) => {
  for (const path of ["/admin/recovery", "/auth/reset"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute(
      "content",
      /noindex/
    );
  }
});
