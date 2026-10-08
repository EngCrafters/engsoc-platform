import { expect, test } from "@playwright/test";

// Isolate the browser's native form behavior without fabricated Auth sessions.
// Route/DB authorization is covered separately; production also gets a real pilot.
for (const policy of ["no-referrer", "same-origin"]) {
  test(`native export POST with ${policy} document policy`, async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const target = `${origin}/__export_origin_sink`;
    let submitted:
      { method: string; origin?: string; referer?: string } | undefined;
    await page.route(target, async (route) => {
      const request = route.request();
      const headers = request.headers();
      submitted = {
        method: request.method(),
        origin: headers.origin,
        referer: headers.referer,
      };
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="origin-regression.csv"',
        },
        body: "Registration status\r\nconfirmed\r\n",
      });
    });
    await page.route(`${origin}/__export_origin_fixture`, (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/html",
          "referrer-policy": "no-referrer",
        },
        body: `<html><head><meta name="referrer" content="${policy}"></head><body><form method="post" action="${target}"><button>Export</button></form></body></html>`,
      })
    );
    await page.goto("/__export_origin_fixture");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("origin-regression.csv");
    expect(submitted?.method).toBe("POST");
    expect(submitted?.origin).toBe(policy === "same-origin" ? origin : "null");
    expect(submitted?.referer).toBe(
      policy === "same-origin" ? `${origin}/__export_origin_fixture` : undefined
    );
  });
}

test("registration export remains POST-only and rejects cross-site requests", async ({
  request,
  baseURL,
}) => {
  const path =
    "/admin/events/11111111-1111-4111-8111-111111111111/registrations/export?status=confirmed";
  expect((await request.get(path)).status()).toBe(405);
  const rejectedHeaders: Record<string, string>[] = [
    { origin: "https://evil.example" },
    { origin: new URL(baseURL!).origin, referer: "https://evil.example/admin" },
    { origin: "null" },
  ];
  for (const headers of rejectedHeaders) {
    expect((await request.post(path, { headers })).status()).toBe(403);
  }
});
