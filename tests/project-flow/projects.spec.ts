import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";
import { join } from "node:path";
import { tmpdir } from "node:os";
const CORE = "http://127.0.0.1:3600",
  WEB = "http://127.0.0.1:3601";
const member = "91000000-0000-4000-8000-000000000002";
const password = "Synthetic-test-password-42!";
async function login(page: Page, email: string, admin = false) {
  await page.goto(
    admin ? `${CORE}/admin/login` : `${WEB}/login?next=%2Fprojects%2Fsubmit`
  );
  await page
    .getByLabel(admin ? "Email address" : "University email", { exact: true })
    .fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("member draft and images → changes requested → reviewed publication → private edits, rejection and scoped access", async ({
  browser,
}) => {
  test.setTimeout(240000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts = [];
  try {
    const owner = await browser.newContext();
    contexts.push(owner);
    const page = await owner.newPage();
    await login(page, "event-member@example.test");
    await expect(page).toHaveURL(`${WEB}/projects/submit`);
    await page.getByRole("button", { name: /^New project/ }).click();
    await page
      .getByLabel("Title — English", { exact: true })
      .fill("Synthetic project journey");
    await page
      .getByLabel("Title — Arabic", { exact: true })
      .fill("رحلة المشروع التجريبي");
    await page
      .getByLabel("Summary — English", { exact: true })
      .fill("A real submission from the local workflow test.");
    await page.getByRole("button", { name: /Project story$/ }).click();
    await page
      .getByLabel("Problem — English", { exact: true })
      .fill("Measure irrigation demand safely.");
    await page
      .getByLabel("Solution — English", { exact: true })
      .fill("A sensor-driven irrigation prototype.");
    await page
      .getByLabel("Technical approach — English", { exact: true })
      .fill("Compare calibrated readings with measured water use.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect
      .poll(async () =>
        Number(
          (
            await db`SELECT count(*) AS n FROM private.projects WHERE member_id=${member}`
          )[0].n
        )
      )
      .toBe(1);
    const [{ id }] =
      await db`SELECT id FROM private.projects WHERE member_id=${member}`;
    await expect(
      (await owner.request.get(`${CORE}/v1/projects/${id}`)).status()
    ).toBe(404);
    await page.getByRole("button", { name: /Images$/ }).click();
    const image = await sharp({
      create: { width: 480, height: 320, channels: 3, background: "#146b50" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("Project images", { exact: true }).setInputFiles({
      name: "synthetic-project.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect
      .poll(async () =>
        Number(
          (
            await db`SELECT count(*) AS n FROM private.project_media WHERE project_id=${id}`
          )[0].n
        )
      )
      .toBe(1);
    const [{ id: media }] =
      await db`SELECT id FROM private.project_media WHERE project_id=${id}`;
    expect(
      (
        await owner.request.get(`${CORE}/v1/projects/${id}/media/${media}`)
      ).status()
    ).toBe(404);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("button", { name: /Review & submit$/ }).click();
    await page
      .getByRole("button", { name: "Submit for review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await db`SELECT status FROM private.projects WHERE id=${id}`)[0]
            .status
      )
      .toBe("submitted");
    const reviewer = await browser.newContext();
    contexts.push(reviewer);
    const admin = await reviewer.newPage();
    await login(admin, "project-reviewer@example.test", true);
    await expect(admin).toHaveURL(`${CORE}/admin/events`);
    await admin.goto(`${CORE}/admin/projects`);
    await expect(
      admin.getByRole("link", {
        name: "Synthetic project journey",
        exact: true,
      })
    ).toBeVisible();
    await admin
      .getByRole("link", { name: "Synthetic project journey", exact: true })
      .click();
    await admin
      .getByRole("button", { name: "Start review", exact: true })
      .click();
    await admin
      .getByLabel("Feedback to member")
      .fill("Please explain the calibration method.");
    await admin
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await db`SELECT status FROM private.projects WHERE id=${id}`)[0]
            .status
      )
      .toBe("changes_requested");
    await page.reload();
    await page
      .getByRole("button", { name: /Synthetic project journey/ })
      .click();
    await expect(
      page.getByText("Please explain the calibration method.", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: /Project story$/ }).click();
    await page
      .getByLabel("Technical approach — English", { exact: true })
      .fill("Calibrate each sensor against a reference meter before trials.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("button", { name: /Review & submit$/ }).click();
    await page
      .getByRole("button", { name: "Submit for review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await db`SELECT status FROM private.projects WHERE id=${id}`)[0]
            .status
      )
      .toBe("submitted");
    await admin.reload();
    await admin
      .getByRole("button", { name: "Start review", exact: true })
      .click();
    await admin.getByRole("checkbox").check();
    await admin
      .getByRole("button", { name: "Approve revision", exact: true })
      .click();
    expect(
      (await reviewer.request.get(`${CORE}/v1/projects/${id}`)).status()
    ).toBe(404);
    await admin
      .getByRole("button", { name: "Publish approved revision", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await reviewer.request.get(`${CORE}/v1/projects/${id}`)).status()
      )
      .toBe(200);
    const publicPage = await reviewer.newPage();
    await publicPage.goto(`${WEB}/projects`);
    await expect(
      publicPage
        .getByRole("heading", {
          name: "Synthetic project journey",
          exact: true,
        })
        .first()
    ).toBeVisible();
    await publicPage.locator(`a[href="/projects/${id}"]`).first().click();
    await expect(publicPage).toHaveURL(`${WEB}/projects/${id}`);
    await expect(
      publicPage.getByRole("heading", {
        name: "Synthetic project journey",
        exact: true,
      })
    ).toBeVisible();
    await publicPage.screenshot({
      path: join(tmpdir(), "essqu-project-public-desktop.png"),
      fullPage: true,
    });
    const publicImage = await reviewer.request.get(
      `${WEB}/media/projects/${id}/${media}`
    );
    expect(publicImage.status()).toBe(200);
    expect(publicImage.headers()["content-type"]).toBe("image/png");
    await page.reload();
    await page
      .getByRole("button", { name: /Synthetic project journey/ })
      .click();
    await page.getByRole("button", { name: /Overview$/ }).click();
    await page
      .getByLabel("Title — English", { exact: true })
      .fill("Private revised project title");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await db`SELECT status FROM private.projects WHERE id=${id}`)[0]
            .status
      )
      .toBe("draft");
    const snapshot = await (
      await reviewer.request.get(`${CORE}/v1/projects/${id}`)
    ).json();
    expect(snapshot.data.projects[0].content.title.en).toBe(
      "Synthetic project journey"
    );
    const outsider = await browser.newContext();
    contexts.push(outsider);
    const other = await outsider.newPage();
    await login(other, "other-manager@example.test", true);
    await expect(other).toHaveURL(`${CORE}/admin/events`);
    await other.goto(`${CORE}/admin/projects/${id}`);
    await expect(
      other.getByRole("heading", { name: "404", exact: true })
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "Publish approved revision" })
    ).toHaveCount(0);
    const tokenReply = await owner.request.post(
      "http://127.0.0.1:3602/auth/v1/token",
      { data: { email: "event-member@example.test", password } }
    );
    const { access_token } = await tokenReply.json();
    const headers = { Authorization: `Bearer ${access_token}`, Origin: WEB };
    const [{ content }] =
      await db`SELECT content FROM private.projects WHERE id=${id}`;
    const rejectedReply = await owner.request.post(`${CORE}/v1/me/projects`, {
      headers,
      data: {
        operation: "create",
        content: {
          ...content,
          title: { en: "Private rejected project", ar: "" },
          mediaIds: [],
        },
      },
    });
    expect(rejectedReply.status()).toBe(201);
    const rejected = (await rejectedReply.json()).data.id;
    expect(
      (
        await owner.request.patch(`${CORE}/v1/me/projects/${rejected}`, {
          headers,
          data: { operation: "submit", revision: 1 },
        })
      ).status()
    ).toBe(200);
    await admin.goto(`${CORE}/admin/projects/${rejected}`);
    await admin
      .getByRole("button", { name: "Start review", exact: true })
      .click();
    await admin
      .getByLabel("Feedback to member")
      .fill("The project needs supporting evidence.");
    await admin.getByRole("button", { name: "Reject", exact: true }).click();
    expect(
      (await owner.request.get(`${CORE}/v1/projects/${rejected}`)).status()
    ).toBe(404);
    await publicPage.goto(`${WEB}/projects`);
    await expect(
      publicPage.getByText("Private rejected project", { exact: true })
    ).toHaveCount(0);
    await expect(
      publicPage.getByText("Private revised project title", { exact: true })
    ).toHaveCount(0);
    for (const width of [375, 1280]) {
      await reviewer.addCookies([{ name: "es-locale", value: "ar", url: WEB }]);
      await publicPage.setViewportSize({ width, height: 850 });
      await publicPage.goto(`${WEB}/projects/${id}`);
      await expect(publicPage.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(
        publicPage.getByRole("heading", {
          name: "رحلة المشروع التجريبي",
          exact: true,
        })
      ).toBeVisible();
      expect(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      if (width === 375)
        await publicPage.screenshot({
          path: join(tmpdir(), "essqu-project-public-mobile.png"),
          fullPage: true,
        });
    }
    await owner.addCookies([{ name: "es-locale", value: "ar", url: WEB }]);
    await page.setViewportSize({ width: 375, height: 850 });
    await page.goto(`${WEB}/projects/submit`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await page.screenshot({
      path: join(tmpdir(), "essqu-project-editor-mobile.png"),
      fullPage: true,
    });
    await admin.goto(`${CORE}/admin/projects/${id}`);
    await admin.getByRole("button", { name: "Unpublish", exact: true }).click();
    await expect
      .poll(async () =>
        (await reviewer.request.get(`${CORE}/v1/projects/${id}`)).status()
      )
      .toBe(404);
    expect(
      (
        await reviewer.request.get(`${CORE}/v1/projects/${id}/media/${media}`)
      ).status()
    ).toBe(404);
  } catch (error) {
    for (const [index, context] of contexts.entries()) {
      const pages = context.pages();
      if (pages[0])
        await test.info().attach(`page-${index}`, {
          body: await pages[0].screenshot({ fullPage: true }),
          contentType: "image/png",
        });
    }
    throw error;
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await db.end({ timeout: 5 });
  }
});
