import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import postgres from "postgres";

const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const AUTH = "http://127.0.0.1:3602";
const sharedPassword = "Synthetic-test-password-42!";
const reviewer = "91000000-0000-4000-8000-000000000005";
const applicant = {
  name: "Profile Flow Member",
  email: "profile-flow@squ.edu.om",
  studentId: "24681357",
  password: "Synthetic-profile-password-42!",
};

const accessToken = (page: Page) =>
  page.evaluate(() => {
    const raw =
      localStorage.getItem("es-member-auth") ??
      sessionStorage.getItem("es-member-auth");
    return raw ? (JSON.parse(raw).access_token as string) : null;
  });

async function inboxLink(page: Page, type: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const mail = (await (
      await page.request.get(`${AUTH}/__test__/inbox`)
    ).json()) as { to: string; type: string; link?: string }[];
    const found = mail.find((m) => m.to === applicant.email && m.type === type);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  throw new Error(`No ${type} email for ${applicant.email}`);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel("University email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("register → confirm → pending → approved → avatar → profile → edit → photo → correction → refresh → sign out", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts = [];
  try {
    // The owner's approval-policy decision, recorded directly in this disposable database.
    await db`UPDATE private.membership_settings SET approval_policy='single_step'`;
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();

    // Signed out: Join stays, and Community invites instead of linking a profile.
    await page.goto(`${WEB}/`);
    const nav = page.getByRole("banner");
    await expect(
      nav.getByRole("link", { name: "Join the Society" }).first()
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: "Open your account menu" })
    ).toHaveCount(0);
    await nav.getByRole("button", { name: "Community" }).click();
    const community = page.locator("#community-menu");
    await expect(community.getByText("Join our society")).toBeVisible();
    await expect(
      community.getByRole("link", { name: "Register", exact: true })
    ).toBeVisible();
    await expect(
      community.getByRole("link", { name: "Sign in", exact: true })
    ).toBeVisible();
    await expect(
      community.getByRole("link", { name: /My profile/ })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Register, with a synthetic ID card.
    await page.goto(`${WEB}/register`);
    await page.getByLabel("Full name", { exact: true }).fill(applicant.name);
    await page
      .getByLabel("University email", { exact: true })
      .fill(applicant.email);
    await page
      .getByLabel("Student ID", { exact: true })
      .fill(applicant.studentId);
    await page.getByLabel("Academic year", { exact: true }).selectOption("2");
    await page.getByLabel("Discipline", { exact: true }).selectOption("civil");
    await page.getByLabel("Password", { exact: true }).fill(applicant.password);
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill(applicant.password);
    const card = await sharp({
      create: { width: 640, height: 400, channels: 3, background: "#e8eef9" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("SQU student ID card").setInputFiles({
      name: "synthetic-card.png",
      mimeType: "image/png",
      buffer: card,
    });
    await expect(page.getByText(/Ready to send/)).toBeVisible();
    await page.getByLabel(/I confirm that these details are mine/).check();
    await page
      .getByRole("button", { name: "Submit application", exact: true })
      .click();

    // Before confirmation, signing in is refused.
    const signup = await inboxLink(page, "signup");
    await signIn(page, applicant.email, applicant.password);
    await expect(
      page.getByRole("alert").filter({ hasText: "Confirm your email first" })
    ).toBeVisible();

    // The emailed link confirms the account and signs it in.
    await page.goto(signup.link!);
    const avatar = page
      .getByRole("banner")
      .getByRole("button", { name: "Open your account menu" });
    await expect(avatar).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Join the Society" })
    ).toHaveCount(0);

    // Pending: an account menu, but no member privileges.
    await avatar.click();
    const menu = page.locator("[data-open] >> text=Application in review");
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "My application" })
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "My profile" })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto(`${WEB}/profile`);
    await expect(
      page.getByRole("heading", { name: "Your membership is on its way" })
    ).toBeVisible();
    const pendingToken = await accessToken(page);
    expect(
      (
        await page.request.get(`${CORE}/v1/me/profile`, {
          headers: { Authorization: `Bearer ${pendingToken}`, Origin: WEB },
        })
      ).status()
    ).toBe(403);

    // A membership reviewer approves the application.
    const [app] =
      await db`SELECT id, revision FROM private.membership_applications WHERE email=${applicant.email}`;
    const [{ result }] =
      await db`SELECT private.review_membership_application(${reviewer}, ${app.id}, ${app.revision}, 'approve', NULL) AS result`;
    expect(result.code).toBe("SUCCESS");

    // Approved: the avatar shows the member, and My profile replaces the Community entry.
    await page.goto(`${WEB}/`);
    await expect(avatar).toContainText("PM");
    await avatar.click();
    await expect(
      page.locator("[data-open]").getByText("Member", { exact: true })
    ).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("link", { name: "My profile" })
      .click();
    await expect(page).toHaveURL(`${WEB}/profile`);
    await expect(
      page.getByRole("heading", { level: 1, name: applicant.name })
    ).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Community" })
      .click();
    await expect(page.locator("#community-menu")).not.toContainText(
      "Join our society"
    );
    await expect(
      page.locator("#community-menu").getByRole("link", { name: /My profile/ })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Real data from the application.
    const verified = page.getByRole("region", { name: "Verified identity" });
    await expect(verified).toContainText(applicant.email);
    await expect(verified).toContainText(applicant.studentId);
    const about = page.getByRole("region", { name: "About you" });
    await expect(about).toContainText("Year 2");

    // Edit: validation first, then a saved change.
    await page.getByRole("link", { name: "Edit profile" }).click();
    await page.getByLabel("Phone number", { exact: true }).fill("12345");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/Enter an international number/)).toBeVisible();
    await page
      .getByLabel("Phone number", { exact: true })
      .fill("+968 9123 4567");
    await page.getByLabel("Academic year", { exact: true }).selectOption("3");
    await about.getByText("Robotics & control").click();
    await about.getByText("Programming").click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Your profile is saved.")).toBeVisible();
    await expect(about).toContainText("+96891234567");
    await expect(about).toContainText("Year 3");

    // Cancel discards an edit.
    await about.getByRole("button", { name: "Edit details" }).click();
    await page.getByLabel("Academic year", { exact: true }).selectOption("5");
    await about.getByRole("button", { name: "Cancel" }).click();
    await expect(about).toContainText("Year 3");

    // Photo: preview, save, and the navbar follows.
    const photo = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#234bc4" },
    })
      .png()
      .toBuffer();
    await page.locator('input[type="file"]').setInputFiles({
      name: "synthetic-photo.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await expect(page.getByText("Preview: not saved yet.")).toBeVisible();
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByText("Your photo is saved.")).toBeVisible();
    await expect(avatar.locator("img")).toBeVisible();
    await expect(
      page.getByAltText(`Profile photo of ${applicant.name}`)
    ).toBeVisible();
    // A file that is not an image never leaves the browser.
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      page.getByText("Choose a JPEG or PNG image of up to 3 MB.")
    ).toBeVisible();

    // A verified field changes only through a reviewer.
    await page.getByRole("button", { name: "Request a correction" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Detail to correct").selectOption("university_id");
    await dialog.getByLabel("Correct value").fill("13579246");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(
      page.getByText("Your request is with the reviewers.")
    ).toBeVisible();
    await expect(verified).toContainText(
      "Correction requested: 13579246 · awaiting review"
    );
    await expect(verified).toContainText(applicant.studentId);

    // Refresh: everything persisted in Core.
    await page.reload();
    await expect(about).toContainText("+96891234567");
    await expect(about).toContainText("Year 3");
    await expect(about).toContainText("Robotics & control");
    await expect(
      page.getByAltText(`Profile photo of ${applicant.name}`)
    ).toBeVisible();
    await expect(avatar.locator("img")).toBeVisible();
    await expect(verified).toContainText("awaiting review");
    const [row] =
      await db`SELECT id, phone, year, interests, photo_key, university_id FROM public.members WHERE email=${applicant.email}`;
    expect(row).toMatchObject({
      phone: "+96891234567",
      year: 3,
      interests: ["robotics", "programming"],
      university_id: applicant.studentId,
    });
    expect(row.photo_key).toMatch(/^member-photos\/[0-9a-f-]{36}\.jpg$/);
    const audit =
      await db`SELECT action FROM private.uc02_audit WHERE actor_user_id=${row.id} ORDER BY occurred_at`;
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "member.profile_updated",
        "member.photo_changed",
        "member.change_requested",
      ])
    );

    // API authorization: the token decides whose profile it is; nothing else does.
    const token = await accessToken(page);
    const own = { Authorization: `Bearer ${token}`, Origin: WEB };
    expect(
      (
        await page.request.get(`${CORE}/v1/me/profile`, {
          headers: { Origin: WEB },
        })
      ).status()
    ).toBe(401);
    const ownPhoto = await page.request.get(`${CORE}/v1/me/profile/photo`, {
      headers: own,
    });
    expect(ownPhoto.status()).toBe(200);
    expect(ownPhoto.headers()["content-type"]).toBe("image/jpeg");
    expect(ownPhoto.headers()["cache-control"]).toContain("no-store");
    const renamed = await page.request.patch(`${CORE}/v1/me/profile`, {
      headers: { ...own, "Content-Type": "application/json" },
      data: {
        phone: null,
        academicYear: 3,
        discipline: "civil",
        interests: [],
        name: "Someone Else",
      },
    });
    expect(renamed.status()).toBe(422);
    const other = (await (
      await page.request.post(`${AUTH}/auth/v1/token?grant_type=password`, {
        data: { email: "event-member@example.test", password: sharedPassword },
      })
    ).json()) as { access_token: string };
    const otherPhoto = await page.request.get(`${CORE}/v1/me/profile/photo`, {
      headers: { Authorization: `Bearer ${other.access_token}`, Origin: WEB },
    });
    expect(otherPhoto.status()).toBe(404);
    const otherProfile = (await (
      await page.request.get(`${CORE}/v1/me/profile`, {
        headers: { Authorization: `Bearer ${other.access_token}`, Origin: WEB },
      })
    ).json()) as { data: { email: string } };
    expect(otherProfile.data.email).toBe("event-member@example.test");

    // The reviewer approves the correction on the dashboard.
    const adminContext = await browser.newContext();
    contexts.push(adminContext);
    const admin = await adminContext.newPage();
    await admin.goto(`${CORE}/admin/login`);
    await admin
      .getByLabel("Email address", { exact: true })
      .fill("project-reviewer@example.test");
    await admin.getByLabel("Password", { exact: true }).fill(sharedPassword);
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await admin.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
    await admin.goto(`${CORE}/admin/membership`);
    const corrections = admin.getByRole("region", {
      name: "Profile corrections",
    });
    await expect(corrections).toContainText("13579246");
    await corrections.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText("Decision saved.")).toBeVisible();
    await page.reload();
    await expect(verified).toContainText("13579246");
    await expect(verified).toContainText("Your correction was approved.");

    // Sign out: the original navbar returns at once.
    await avatar.click();
    await page
      .getByRole("button", { name: "Sign out", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(`${WEB}/`);
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Join the Society" })
        .first()
    ).toBeVisible();
    await expect(avatar).toHaveCount(0);
    await page.goto(`${WEB}/profile`);
    await expect(
      page.getByRole("heading", { name: "Sign in to see your profile" })
    ).toBeVisible();

    // Phone width, in Arabic: the account sits in the menu panel, right to left.
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    contexts.push(mobile);
    const phone = await mobile.newPage();
    await signIn(phone, applicant.email, applicant.password);
    await phone
      .context()
      .addCookies([{ name: "es-locale", value: "ar", url: WEB }]);
    await phone.goto(`${WEB}/profile`);
    await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      phone.getByRole("heading", { level: 1, name: applicant.name })
    ).toBeVisible();
    await expect(phone.getByText("الهوية الموثّقة")).toBeVisible();
    await phone.getByRole("button", { name: "فتح القائمة" }).click();
    await expect(
      phone.getByRole("link", { name: "ملفي" }).first()
    ).toBeVisible();
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  } finally {
    for (const context of contexts) await context.close();
    await db.end();
  }
});
