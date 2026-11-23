import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Automatic membership approval (ADR 0029, migration 0037) through both applications: register on
// the website, confirm the email from the synthetic inbox, and arrive as a member with a profile,
// with no reviewer; the dashboard shows the registration as approved and the person as a member.
const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const AUTH = "http://127.0.0.1:3602";
const adminPassword = "Synthetic-test-password-42!";
const person = {
  name: "Automatic Flow Member",
  email: "automatic.flow@example.org",
  password: "Synthetic-automatic-password-42!",
};

async function inboxLink(page: Page, type: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const mail = (await (
      await page.request.get(`${AUTH}/__test__/inbox`)
    ).json()) as { to: string; type: string; link?: string }[];
    const found = mail.find((m) => m.to === person.email && m.type === type);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  throw new Error(`No ${type} email for ${person.email}`);
}

async function adminLogin(page: Page, email: string) {
  await page.goto(`${CORE}/admin/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
}

async function fillRegistration(page: Page) {
  await page.getByLabel("Full name", { exact: true }).fill(person.name);
  await page.getByLabel("Email address", { exact: true }).fill(person.email);
  await page
    .getByRole("radio", { name: "University Student", exact: true })
    .check({ force: true }); // a styled chip: its label text takes the click
  await page.getByLabel("University", { exact: true }).selectOption("squ");
  await page.getByLabel("Academic year", { exact: true }).selectOption("4");
  await page.getByLabel("Discipline", { exact: true }).selectOption("civil");
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(person.password);
  await page.getByLabel(/I confirm that these details are mine/).check();
}
const submit = (page: Page) =>
  page.getByRole("button", { name: "Submit application", exact: true }).click();

test("register → approved at once → confirm email → member with a profile, on the dashboard, no reviewer", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts = [];
  // Every spec submits from 127.0.0.1, which Core allows five times an hour: this spec gives its
  // own attempts back afterwards so the specs after it keep their budget.
  const [{ started }] = await db`SELECT clock_timestamp() AS started`;
  try {
    // The policy 0037 records; set again because other specs in this run choose their own.
    await db`UPDATE private.membership_settings SET approval_policy='automatic'`;
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();

    // Core tells the website that registrations are approved at once. (The page's note follows
    // it through a five-minute cache, so it is not asserted here: earlier specs change the policy.)
    const options = await (
      await page.request.get(`${CORE}/v1/membership-options`, {
        headers: { Origin: WEB },
      })
    ).json();
    expect(options.data.approval).toBe("automatic");
    await page.goto(`${WEB}/register`);

    // Invalid input: field errors, nothing stored.
    await submit(page);
    await expect(page.getByText(/fields? needs? attention/)).toBeVisible();
    expect(
      await db`SELECT 1 FROM private.membership_applications WHERE email=${person.email}`
    ).toHaveLength(0);

    // A valid registration is approved at once.
    await fillRegistration(page);
    await submit(page);
    await expect(
      page.getByRole("heading", { name: "Welcome to the society" })
    ).toBeVisible();
    await expect(page.getByText("Your membership is approved.")).toBeVisible();
    await expect(
      page.getByText(
        `We sent a confirmation link to ${person.email}. Confirm your email to activate your membership, then sign in.`
      )
    ).toBeVisible();
    const [application] = await db`
      SELECT id, status, auto_approved, decided_by, member_id FROM private.membership_applications
      WHERE email=${person.email}`;
    expect(application).toMatchObject({
      status: "approved",
      auto_approved: true,
      decided_by: null,
      member_id: null,
    });

    // The dashboard opens on Approved, where the registration already is.
    const reviewerContext = await browser.newContext();
    contexts.push(reviewerContext);
    const reviewer = await reviewerContext.newPage();
    await adminLogin(reviewer, "project-reviewer@example.test");
    await reviewer.goto(`${CORE}/admin/membership`);
    await expect(
      reviewer.getByText(
        /register on the website and are approved automatically/
      )
    ).toBeVisible();
    await expect(
      reviewer.getByRole("tab", { name: /Approved/ })
    ).toHaveAttribute("aria-selected", "true");
    const row = reviewer.getByRole("row").filter({ hasText: person.name });
    await expect(row).toContainText("Activation pending");
    await reviewer.goto(`${CORE}/admin/membership/${application.id}`);
    await expect(
      reviewer.getByText(/automatically at registration/)
    ).toBeVisible();

    // Signing in before the email is confirmed is refused by Supabase Auth.
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email address", { exact: true }).fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill(person.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Confirm your email first" })
    ).toBeVisible();

    // The confirmation link signs in, and the person is a member straight away.
    await page.goto((await inboxLink(page, "signup")).link!);
    const avatar = page
      .getByRole("banner")
      .getByRole("button", { name: "Open your account menu" });
    await expect(avatar).toContainText("AM");
    await avatar.click();
    await expect(
      page.locator("[data-open]").getByText("Member", { exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`${WEB}/profile`);
    await expect(
      page.getByRole("heading", { level: 1, name: person.name })
    ).toBeVisible();
    const about = page.getByRole("region", { name: "About you" });
    await expect(about).toContainText("Year 4");
    await expect(about).toContainText("University Student");

    // A member record, and nothing more: no administrative access, committee or leadership.
    const [member] = await db`
      SELECT m.id, m.status::text AS status,
        (SELECT count(*)::int FROM public.administrative_access a WHERE a.user_id = m.id) AS access,
        (SELECT count(*)::int FROM private.committee_members c WHERE c.member_id = m.id) AS committees,
        (SELECT count(*)::int FROM private.leadership_appointments l WHERE l.member_id = m.id) AS leadership
      FROM public.members m WHERE m.email=${person.email}`;
    expect(member).toMatchObject({
      status: "member",
      access: 0,
      committees: 0,
      leadership: 0,
    });

    // The dashboard: account active, and listed among members.
    await reviewer.goto(`${CORE}/admin/membership`);
    await expect(
      reviewer.getByRole("row").filter({ hasText: person.name })
    ).toContainText("Account active");
    const boardContext = await browser.newContext();
    contexts.push(boardContext);
    const board = await boardContext.newPage();
    await adminLogin(board, "board-admin@example.test");
    await board.goto(
      `${CORE}/admin/administration/members?q=${encodeURIComponent(person.email)}`
    );
    await expect(board.getByText(person.name).first()).toBeVisible();

    // The same email again: already a member, nothing new stored.
    const againContext = await browser.newContext();
    contexts.push(againContext);
    const again = await againContext.newPage();
    await again.goto(`${WEB}/register`);
    await fillRegistration(again);
    await submit(again);
    await expect(again.getByText("You’re already a member")).toBeVisible();
    expect(
      await db`SELECT 1 FROM private.membership_applications WHERE email=${person.email}`
    ).toHaveLength(1);
  } finally {
    for (const context of contexts) await context.close();
    await db`DELETE FROM private.membership_submission_attempts WHERE created_at >= ${started}`;
    await db.end();
  }
});
