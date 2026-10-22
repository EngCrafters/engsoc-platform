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
  if (
    typeof eventId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(eventId) ||
    typeof landingOidcToken !== "string" ||
    !/^\S+$/.test(landingOidcToken)
  ) {
    throw new Error(
      "Valid staging event and Landing preview identity required"
    );
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
    });
    const writes = [];
    let corePostAttempts = 0;
    let routeValidationFailed = false;
    await context.route("**/*", async (route) => {
      // Route callbacks reject independently of the caller's awaited response.
      // Contain every failure here: abort before network and retain only a flag.
      try {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "POST" && url.origin === CORE) {
          corePostAttempts++;
          if (
            corePostAttempts !== 1 ||
            url.pathname !== `/v1/events/${eventId}/registrations` ||
            url.search
          ) {
            throw new Error("Unexpected staging browser submission");
          }
          const headers = await request.allHeaders();
          for (const key of [
            "authorization",
            "cookie",
            "x-vercel-trusted-oidc-idp-token",
            "x-vercel-protection-bypass",
          ]) {
            if (headers[key] !== undefined) {
              throw new Error("Browser registration contains credentials");
            }
          }
          const body = request.postDataJSON();
          const keys = Object.keys(body).sort();
          if (
            JSON.stringify(keys) !==
              JSON.stringify(["attendeeEmail", "attendeeName", "intent"]) ||
            body.attendeeName !== attendeeName ||
            body.attendeeEmail !== attendeeEmail ||
            body.intent !== "register"
          ) {
            throw new Error("Unexpected browser registration payload");
          }
          writes.push(request);
        }
        if (url.origin === LANDING) {
          await route.continue({
            headers: {
              ...request.headers(),
              "x-vercel-trusted-oidc-idp-token": landingOidcToken,
            },
          });
        } else {
          await route.continue();
        }
      } catch {
        routeValidationFailed = true;
        await route.abort().catch(() => {});
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
    const pending = page
      .waitForResponse(
        (r) =>
          r.url() === `${CORE}/v1/events/${eventId}/registrations` &&
          r.request().method() === "POST",
        { timeout: 30000 }
      )
      .catch(() => null);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    const response = await pending;
    if (!response) throw new Error("Staging browser response unavailable");
    const text = await response.text();
    const headers = new Headers(await response.allHeaders());
    assert.equal(
      routeValidationFailed,
      false,
      "Browser route validation failed"
    );
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
    assert.equal(
      routeValidationFailed,
      false,
      "Browser route validation failed"
    );
    assert.equal(corePostAttempts, 1, "Unexpected browser submission attempt");
    assert.equal(writes.length, 1, "Registration must not retry automatically");
    console.log(
      "PASS live Landing browser: confirmed registration, direct credential-free Core POST, exact payload, request ID and no retry"
    );
    return { status: response.status(), body: JSON.parse(text), text, headers };
  } catch {
    // Playwright assertions can include DOM text or header actual values.
    // Expose no original error/cause, even when this helper is called directly.
    throw new Error(
      "Staging browser verification failed; private diagnostics suppressed"
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
