import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import jsQR from "jsqr";
import postgres from "postgres";

const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const password = "Synthetic-test-password-42!";
const member = "91000000-0000-4000-8000-000000000002";
async function login(
  page: Page,
  email: string,
  admin = false,
  returnTo?: string
) {
  if (admin) await page.goto(`${CORE}/admin/login`);
  else if (returnTo)
    await page.goto(`${WEB}/login?next=${encodeURIComponent(returnTo)}`);
  await page
    .getByLabel(admin ? "Email address" : "University email", { exact: true })
    .fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("create/edit media → real member/waitlist registration → rotating QR → explicit attendance → scoped dashboard/export", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts = [];
  try {
    const managerContext = await browser.newContext();
    contexts.push(managerContext);
    const admin = await managerContext.newPage();
    await login(admin, "event-manager@example.test", true);
    await expect(admin).toHaveURL(`${CORE}/admin/events`);
    await admin.goto(`${CORE}/admin/events/new`);
    await admin.locator("#event-title").fill("Synthetic event management flow");
    const description =
      "Workshop details\n[SQU website](https://www.squ.edu.om)\nمرحبا https://example.com/details\n<script>window.xssExecuted=true</script>\n[Unsafe](javascript:alert(1))";
    await admin.locator("#event-description").fill(description);
    await admin
      .locator("#event-date")
      .fill(new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 16));
    await admin
      .getByLabel("Location", { exact: true })
      .fill("Synthetic Engineering Hall");
    await admin
      .getByLabel("Phone Number for Registration")
      .selectOption("required");
    await admin.getByRole("switch", { name: "Limit capacity" }).click();
    await admin.locator("#event-capacity").fill("1");
    const image = await sharp({
      create: { width: 240, height: 160, channels: 3, background: "#146b50" },
    })
      .png()
      .toBuffer();
    await admin.getByLabel("Cover image").setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(admin.getByAltText("Event cover preview")).toBeVisible();
    await managerContext.request.post(
      "http://127.0.0.1:3602/__test__/fail-next-cover"
    );
    await admin
      .getByRole("button", { name: "Create draft", exact: true })
      .click();
    await expect(
      admin
        .getByRole("alert")
        .filter({ hasText: "The image could not be uploaded" })
    ).toBeVisible();
    await expect(admin.locator("#event-title")).toHaveValue(
      "Synthetic event management flow"
    );
    await expect(
      admin.getByRole("switch", { name: "Limit capacity" })
    ).toBeChecked();
    await expect(admin.locator("#event-capacity")).toHaveValue("1");
    expect(
      await admin
        .locator("#event-cover")
        .evaluate((input: HTMLInputElement) => input.files?.length)
    ).toBe(1);
    await admin
      .getByRole("button", { name: "Create draft", exact: true })
      .click();
    await expect(admin).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}$/);
    const id = new URL(admin.url()).pathname.split("/").at(-1)!;
    await expect(admin.getByAltText("Event cover preview")).toBeVisible();
    await admin
      .locator("#event-title")
      .fill("Synthetic event management flow · updated");
    await admin
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Synthetic event management flow · updated"
    );
    await admin.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    await admin
      .getByRole("button", { name: "Publish event", exact: true })
      .click();
    await expect(
      admin.getByRole("button", { name: "Mark registration full", exact: true })
    ).toBeVisible();

    const visitorContext = await browser.newContext();
    contexts.push(visitorContext);
    const visitor = await visitorContext.newPage();
    await visitor.goto(`${WEB}/events/${id}`);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      "Synthetic event management flow · updated"
    );
    await expect(
      visitor.getByRole("link", { name: "SQU website", exact: true })
    ).toHaveAttribute("href", "https://www.squ.edu.om/");
    await expect(
      visitor.getByRole("link", { name: "Unsafe", exact: true })
    ).toHaveCount(0);
    expect(await visitor.evaluate(() => "xssExecuted" in window)).toBe(false);
    // Production streaming briefly keeps a hidden copy of the page (React's
    // `S:` container) until it is swapped in; count images only after that.
    await expect(visitor.locator('div[hidden][id^="S:"]')).toHaveCount(0);
    const cover = visitor.getByAltText(
      "Synthetic event management flow · updated",
      { exact: true }
    );
    await expect(cover).toBeVisible();
    await expect
      .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    expect(await visitor.content()).not.toMatch(/essq_test_eventflow_/);
    await login(visitor, "event-member@example.test", false, `/events/${id}`);
    await expect(visitor).toHaveURL(`${WEB}/events/${id}`);
    await visitor
      .getByRole("button", { name: "Register", exact: true })
      .click();
    const dialog = visitor.getByRole("dialog");
    await expect(dialog.getByLabel("Full name", { exact: true })).toHaveValue(
      "Synthetic Member"
    );
    await expect(
      dialog.getByLabel("Full name", { exact: true })
    ).toHaveAttribute("readonly", "");
    await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(
      "event-member@example.test"
    );
    await dialog
      .getByLabel("Phone number", { exact: true })
      .fill("+968 9123 4567");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      visitor.getByText("You’re registered", { exact: true })
    ).toBeVisible();
    const [profile] =
      await db`SELECT phone FROM public.members WHERE id=${member}`;
    expect(profile.phone).toBe("+96891234567");
    const [registered] =
      await db`SELECT * FROM public.registrations WHERE event_id=${id} AND member_id=${member}`;
    expect(registered.attendee_email).toBe("event-member@example.test");
    expect(registered.attended).toBe(false);

    const waitContext = await browser.newContext();
    contexts.push(waitContext);
    const waiting = await waitContext.newPage();
    await login(
      waiting,
      "waitlist-member@example.test",
      false,
      `/events/${id}`
    );
    await expect(waiting).toHaveURL(`${WEB}/events/${id}`);
    // Public availability may still be cached as open. Core must refuse the
    // full seat and offer a separately confirmed waitlist in that case.
    const registerChoice = waiting.getByRole("button", {
      name: /^(Register|Join (?:the )?waitlist)$/,
    });
    await expect(registerChoice).toBeVisible();
    const staleOpen =
      (await registerChoice.textContent())?.trim() === "Register";
    await waiting
      .getByRole("button", {
        name: staleOpen ? "Register" : "Join the waitlist",
        exact: true,
      })
      .click();
    await waiting
      .getByRole("dialog")
      .getByLabel("Phone number", { exact: true })
      .fill("+968 9234 5678");
    await waiting
      .getByRole("dialog")
      .getByRole("button", {
        name: staleOpen ? "Confirm" : "Join waitlist",
        exact: true,
      })
      .click();
    if (staleOpen)
      await waiting
        .getByRole("dialog")
        .getByRole("button", { name: "Join waitlist", exact: true })
        .click();
    await expect(
      waiting.getByText("You’re on the waitlist", { exact: true })
    ).toBeVisible();

    await admin.goto(`${CORE}/admin/events/${id}/attendance`);
    await admin
      .getByRole("button", { name: "Open check-in", exact: true })
      .click();
    await expect(admin.getByText(/Check-in open until/)).toBeVisible();
    const qr = await admin
      .getByAltText(/Attendance QR for/)
      .getAttribute("src");
    const raw = await sharp(Buffer.from(qr!.split(",")[1], "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = jsQR(
      new Uint8ClampedArray(raw.data),
      raw.info.width,
      raw.info.height
    );
    expect(decoded).toBeTruthy();
    const scan = decoded!.data;
    expect(scan).toMatch(
      new RegExp(`^${WEB}/events/${id}/attendance#checkin=[a-f0-9]{64}$`)
    );
    expect(scan).not.toMatch(/@|essq_|Bearer|eyJ/);
    // A second organizer screen shows a live code too and invalidates nothing:
    // the code already scanned above is confirmed below.
    const secondScreen = await managerContext.newPage();
    await secondScreen.goto(`${CORE}/admin/events/${id}/attendance`);
    const secondQr = await secondScreen
      .getByAltText(/Attendance QR for/)
      .getAttribute("src");
    const secondRaw = await sharp(
      Buffer.from(secondQr!.split(",")[1], "base64")
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(
      jsQR(
        new Uint8ClampedArray(secondRaw.data),
        secondRaw.info.width,
        secondRaw.info.height
      )?.data
    ).toMatch(
      new RegExp(`^${WEB}/events/${id}/attendance#checkin=[a-f0-9]{64}$`)
    );
    await secondScreen.close();
    const [before] =
      await db`SELECT attended FROM public.registrations WHERE id=${registered.id}`;
    expect(before.attended).toBe(false);
    const scannerContext = await browser.newContext();
    contexts.push(scannerContext);
    const scanner = await scannerContext.newPage();
    await scanner.goto(scan);
    await expect(scanner).toHaveURL(/\/login\?next=/);
    expect(scanner.url()).not.toContain("checkin");
    await login(scanner, "event-member@example.test");
    await expect(scanner).toHaveURL(`${WEB}/events/${id}/attendance`);
    // In the page itself: the navbar's account menu also names the member.
    await expect(
      scanner.getByRole("main").getByText("Synthetic Member", { exact: true })
    ).toBeVisible();
    const [opened] =
      await db`SELECT attended FROM public.registrations WHERE id=${registered.id}`;
    expect(opened.attended).toBe(false);
    await scanner
      .getByRole("button", { name: "Confirm Attendance", exact: true })
      .click();
    await expect(
      scanner.getByText("Your attendance has been recorded.", { exact: true })
    ).toBeVisible();
    const [attended] =
      await db`SELECT attended,checked_in_at FROM public.registrations WHERE id=${registered.id}`;
    expect(attended.attended).toBe(true);
    expect(attended.checked_in_at).toBeInstanceOf(Date);
    await scanner.reload();
    await expect(
      scanner.getByText("Your attendance was already recorded.", {
        exact: true,
      })
    ).toBeVisible();
    const [audit] =
      await db`SELECT count(*)::integer AS count FROM private.uc02_audit WHERE registration_id=${registered.id} AND action='attendance.confirmed'`;
    expect(audit.count).toBe(1);

    await waiting.goto(scan);
    await expect(
      waiting.getByText(/Waitlisted — a confirmed place is required/)
    ).toBeVisible();
    await expect(
      waiting.getByRole("button", { name: "Confirm Attendance", exact: true })
    ).toBeDisabled();
    await admin.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      admin.getByRole("cell", { name: "Attended · QR", exact: true })
    ).toBeVisible();
    await admin
      .getByLabel("Search participants")
      .fill("event-member@example.test");
    await admin.getByRole("button", { name: "Refresh", exact: true }).click();
    const memberRow = admin
      .getByRole("row")
      .filter({ hasText: "event-member@example.test" });
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow).toContainText("Attended · QR");
    // Organizer-assisted correction: undo, then check in again, each with a reason.
    await memberRow.getByRole("button", { name: "Undo", exact: true }).click();
    await admin
      .getByRole("group", { name: "Manual attendance" })
      .getByRole("button", { name: "Confirm undo", exact: true })
      .click();
    await expect(memberRow).toContainText("Not checked in");
    await memberRow
      .getByRole("button", { name: "Check in", exact: true })
      .click();
    await admin
      .getByLabel("Reason", { exact: true })
      .selectOption("organizer_verified");
    await admin
      .getByRole("group", { name: "Manual attendance" })
      .getByRole("button", { name: "Confirm check-in", exact: true })
      .click();
    await expect(memberRow).toContainText("Attended · manual");
    const manualAudit =
      await db`SELECT action,changes->>'reason' AS reason FROM private.uc02_audit WHERE registration_id=${registered.id} AND action LIKE 'attendance.manual%' ORDER BY occurred_at`;
    expect(manualAudit).toEqual([
      { action: "attendance.manual_reverted", reason: "recorded_in_error" },
      { action: "attendance.manual_confirmed", reason: "organizer_verified" },
    ]);
    const download = admin.waitForEvent("download");
    await admin
      .getByRole("button", { name: "Export attendance CSV", exact: true })
      .click();
    const csv = await download;
    expect(csv.suggestedFilename()).toBe(`attendance-${id}.csv`);
    await admin
      .getByRole("button", { name: "Close check-in", exact: true })
      .click();
    await expect(
      admin.getByText("Check-in closed", { exact: true })
    ).toBeVisible();
    // Replace/remove the uploaded cover through the same saved event form.
    const [oldCover] =
      await db`SELECT cover_image_key FROM public.events WHERE id=${id}`;
    await admin.goto(`${CORE}/admin/events/${id}`);
    const replacement = await sharp({
      create: { width: 320, height: 160, channels: 3, background: "#d97045" },
    })
      .png()
      .toBuffer();
    await admin.getByLabel("Cover image").setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: replacement,
    });
    await admin
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect
      .poll(async () => {
        const [row] =
          await db`SELECT cover_image_key FROM public.events WHERE id=${id}`;
        return row.cover_image_key;
      })
      .not.toBe(oldCover.cover_image_key);
    const replaced = await managerContext.request.get(
      `${CORE}/admin/events/${id}/image`
    );
    expect(replaced.status()).toBe(200);
    expect((await sharp(await replaced.body()).metadata()).width).toBe(320);
    await admin
      .getByRole("button", { name: "Remove image", exact: true })
      .click();
    await admin
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect
      .poll(async () => {
        const [row] =
          await db`SELECT cover_image_key FROM public.events WHERE id=${id}`;
        return row.cover_image_key;
      })
      .toBeNull();
    expect(
      (
        await managerContext.request.get(`${CORE}/admin/events/${id}/image`)
      ).status()
    ).toBe(404);

    const foreignContext = await browser.newContext();
    contexts.push(foreignContext);
    const foreign = await foreignContext.newPage();
    await login(foreign, "other-manager@example.test", true);
    await expect(foreign).toHaveURL(`${CORE}/admin/events`);
    const foreignResponse = await foreign.goto(
      `${CORE}/admin/events/${id}/attendance`
    );
    // Next's streamed not-found UI may have already committed a 200 document.
    expect([200, 404]).toContain(foreignResponse?.status());
    await expect(
      foreign.getByRole("heading", { name: "404", exact: true })
    ).toBeVisible();
    await expect(
      foreign.getByRole("button", { name: "Open check-in", exact: true })
    ).toHaveCount(0);
    const exportRefused = await foreignContext.request.post(
      `${CORE}/admin/events/${id}/attendance/export`,
      {
        headers: {
          Origin: CORE,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "filter=all&search=",
      }
    );
    expect(exportRefused.status()).toBe(404);
    for (const width of [375, 1280]) {
      await scanner.setViewportSize({ width, height: 850 });
      await scannerContext.addCookies([
        { name: "es-locale", value: "ar", url: WEB },
      ]);
      await scanner.goto(`${WEB}/events/${id}/attendance`);
      await expect(scanner.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(
        scanner.getByRole("heading", { name: "تأكيد الحضور", exact: true })
      ).toBeVisible();
      expect(
        await scanner.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        )
      ).toBe(true);
    }
    // An authenticated non-member can explicitly use the existing guest
    // contract. The supplied guest identity never becomes a verified Member.
    const guestContext = await browser.newContext();
    contexts.push(guestContext);
    const guest = await guestContext.newPage();
    await guest.goto(`${WEB}/login`);
    await login(guest, "other-manager@example.test");
    await expect(
      guest.getByRole("button", { name: "Sign out", exact: true })
    ).toBeVisible();
    await guest.goto(`${WEB}/events/${id}`);
    await guest
      .getByRole("button", { name: /^(Register|Join (?:the )?waitlist)$/ })
      .click();
    await guest
      .getByRole("button", { name: "Continue as guest", exact: true })
      .click();
    const guestDialog = guest.getByRole("dialog");
    await guestDialog
      .getByLabel("Full name", { exact: true })
      .fill("Synthetic Guest");
    await guestDialog
      .getByLabel("Email", { exact: true })
      .fill("legacy-guest@example.test");
    await guestDialog
      .getByLabel("Phone number", { exact: true })
      .fill("+968 9345 6789");
    const guestResult = guest.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/v1/events/${id}/registrations`)
    );
    await guestDialog
      .getByRole("button", { name: /^(Confirm|Join waitlist)$/ })
      .click();
    const firstGuest = await guestResult;
    expect(
      (await firstGuest.request().allHeaders()).authorization
    ).toBeUndefined();
    if (firstGuest.status() === 409)
      await guestDialog
        .getByRole("button", { name: "Join waitlist", exact: true })
        .click();
    await expect(
      guest.getByText("You’re on the waitlist", { exact: true })
    ).toBeVisible();
    const [guestRow] =
      await db`SELECT member_id,status FROM public.registrations WHERE event_id=${id} AND attendee_email='legacy-guest@example.test'`;
    expect(guestRow).toEqual({ member_id: null, status: "waitlisted" });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await db.end();
  }
});
