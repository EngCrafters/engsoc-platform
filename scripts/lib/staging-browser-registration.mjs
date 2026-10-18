import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const LANDING = "https://essqu-web-git-staging-eng-crafters.vercel.app";
const CORE = "https://engsoc-platform-git-staging-eng-crafters.vercel.app";

/** One real staging UI submission. The platform token only reaches Landing. */
export async function submitStagingRegistration({
  eventId,
  attendeeName,
  attendeeEmail,
  landingOidcToken,
}) {
  assert.match(eventId, /^[a-f0-9-]{36}$/);
  assert.ok(landingOidcToken, "Landing preview identity required");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
    });
    const writes = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === LANDING) {
        await route.continue({
          headers: {
            ...request.headers(),
            "x-vercel-trusted-oidc-idp-token": landingOidcToken,
          },
        });
      } else {
        if (request.method() === "POST" && url.origin === CORE) {
          assert.equal(url.pathname, `/v1/events/${eventId}/registrations`);
          const headers = await request.allHeaders();
          for (const key of [
            "authorization",
            "cookie",
            "x-vercel-trusted-oidc-idp-token",
            "x-vercel-protection-bypass",
          ])
            assert.equal(
              headers[key],
              undefined,
              "Browser registration contains credentials"
            );
          const body = request.postDataJSON();
          assert.deepEqual(
            Object.keys(body).sort(),
            ["attendeeName", "attendeeEmail", "intent"].sort()
          );
          assert.equal(body.attendeeName, attendeeName);
          assert.equal(body.attendeeEmail, attendeeEmail);
          assert.equal(body.intent, "register");
          writes.push(request);
        }
        await route.continue();
      }
    });
    const page = await context.newPage();
    await page.goto(`${LANDING}/events/${eventId}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await expect(page.getByLabel("Full name")).toBeVisible({ timeout: 30000 });
    assert.ok(
      !/essq_(test|live)_[a-z0-9_]+_[A-Za-z0-9_-]{32,}/.test(
        await page.content()
      ),
      "Browser document contains an API credential"
    );
    await page.getByLabel("Full name").fill(attendeeName);
    await page.getByLabel("Email address").fill(attendeeEmail);
    const pending = page.waitForResponse(
      (r) =>
        r.url() === `${CORE}/v1/events/${eventId}/registrations` &&
        r.request().method() === "POST",
      { timeout: 30000 }
    );
    await page.getByRole("button", { name: "Register", exact: true }).click();
    const response = await pending;
    const text = await response.text();
    const headers = new Headers(await response.allHeaders());
    assert.equal(writes.length, 1, "One submission must send one POST");
    assert.equal(
      headers.get("x-request-id"),
      (await writes[0].allHeaders())["x-request-id"]
    );
    await expect(page.getByRole("status")).toContainText(
      "Your place is confirmed",
      { timeout: 15000 }
    );
    await page.waitForTimeout(1000);
    assert.equal(writes.length, 1, "Registration must not retry automatically");
    console.log(
      "PASS live Landing browser: confirmed registration, direct credential-free Core POST, exact payload, request ID and no retry"
    );
    return { status: response.status(), body: JSON.parse(text), text, headers };
  } finally {
    await browser.close();
  }
}
