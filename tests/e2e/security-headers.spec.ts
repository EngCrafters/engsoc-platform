import { expect, test } from "@playwright/test";

test("public and protected responses carry security headers", async ({
  request,
}) => {
  for (const path of ["/", "/admin/access"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'"
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});
