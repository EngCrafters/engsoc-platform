import { expect, test } from "@playwright/test";
import { E2E_EVENTS } from "./fixtures";

/**
 * The attendee phone field, as a visitor actually meets it.
 *
 * The database contract is proven in tests/db/registration-phone.test.ts. What
 * these cover is the part only a browser can: the input type and its mobile
 * keyboard hints, that the field is a real labelled control, and that each
 * outcome reaches the visitor as a translated message.
 */

function region(page: import("@playwright/test").Page) {
  return page.locator('section[aria-labelledby="registration-heading"]');
}

test("the phone field is a labelled tel input, not a number input", async ({
  page,
}) => {
  await page.goto(`/events/${E2E_EVENTS.open}`);

  const phone = page.getByLabel("Phone number");
  await expect(phone).toBeVisible();
  // type="tel" and inputMode="tel" give phones a dial pad. type="number" would
  // strip a leading zero, refuse a leading "+", and imply a quantity.
  await expect(phone).toHaveAttribute("type", "tel");
  await expect(phone).toHaveAttribute("inputmode", "tel");
  await expect(phone).toHaveAttribute("autocomplete", "tel");
  // The hint must not be the only accessible label.
  await expect(phone).toHaveAttribute("aria-describedby", "attendeePhone-hint");
});

test("a missing phone is reported on the phone field", async ({
  page,
}, testInfo) => {
  const email = `no-phone-${testInfo.project.name}@example.test`;
  await page.goto(`/events/${E2E_EVENTS.open}`);

  await page.getByLabel("Name").fill("No Phone");
  await page.getByLabel("Email address").fill(email);
  // Everything except the phone.
  await page.getByRole("button", { name: "Register" }).click();

  const alert = region(page).getByRole("alert");
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("contact number");
  // The field itself is marked invalid for assistive technology.
  await expect(page.getByLabel("Phone number")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
});

test("a formatted international number is accepted", async ({
  page,
}, testInfo) => {
  const email = `formatted-${testInfo.project.name}@example.test`;
  await page.goto(`/events/${E2E_EVENTS.open}`);

  await page.getByLabel("Name").fill("Formatted Number");
  await page.getByLabel("Email address").fill(email);
  // Typed the way a person writes it: country code, spaces, brackets, dashes.
  await page.getByLabel("Phone number").fill("+968 (9123) 4567");
  await page.getByRole("button", { name: "Register" }).click();

  await expect(region(page).getByRole("status")).toContainText(
    "place is confirmed"
  );
});

test("letters in the phone field are refused", async ({ page }, testInfo) => {
  const email = `letters-${testInfo.project.name}@example.test`;
  await page.goto(`/events/${E2E_EVENTS.open}`);

  await page.getByLabel("Name").fill("Letters");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Phone number").fill("+968abc4567");
  await page.getByRole("button", { name: "Register" }).click();

  await expect(region(page).getByRole("alert")).toContainText("contact number");
});

test("the waitlist also captures a phone", async ({ page }, testInfo) => {
  const email = `waitlist-phone-${testInfo.project.name}@example.test`;
  await page.goto(`/events/${E2E_EVENTS.waitlist}`);

  await page.getByLabel("Name").fill("Waitlist Phone");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Phone number").fill("+15550100013");
  await page.getByRole("button", { name: "Join waitlist" }).click();

  await expect(region(page).getByRole("status")).toContainText(
    "on the waitlist"
  );
});
