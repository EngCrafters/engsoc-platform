import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// The account activation setting (ADR 0030, migration 0038) through both applications: a
// Technical administrator switches to immediate activation on the dashboard; a registrant is
// signed in at once with no confirmation email, sets a password that works later, and appears on
// the dashboard as created without email verification. An address that already has an account is
// never signed in to or changed.
const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const AUTH = "http://127.0.0.1:3602";
const adminPassword = "Synthetic-test-password-42!";
const person = {
  name: "Immediate Flow Member",
  email: "immediate.flow@example.org",
  password: "Synthetic-immediate-password-42!",
};
const existing = "other-manager@example.test";

async function adminLogin(page: Page, email: string) {
  await page.goto(`${CORE}/admin/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
}

async function register(page: Page, email: string, password: string) {
  await page.goto(`${WEB}/register`);
  await page.getByLabel("Full name", { exact: true }).fill(person.name);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByRole("radio", { name: "Industry Professional", exact: true })
    .check({ force: true }); // a styled chip: its label text takes the click
  await page.getByLabel("Discipline", { exact: true }).selectOption("civil");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByLabel(/I confirm that these details are mine/).check();
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
}

test("switch to immediate activation → register → signed in at once with no email → password works later; existing accounts untouched", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts = [];
  // Every spec submits from 127.0.0.1 (five an hour): this one gives its attempts back.
  const [{ started }] = await db`SELECT clock_timestamp() AS started`;
  try {
    await db`UPDATE private.membership_settings
      SET approval_policy='automatic', account_activation='email_confirmation'`;

    // 0. A reviewer without the membership settings permission sees the mode, and no controls.
    const reviewerContext = await browser.newContext();
    contexts.push(reviewerContext);
    const reviewer = await reviewerContext.newPage();
    await adminLogin(reviewer, "project-reviewer@example.test");
    await reviewer.goto(`${CORE}/admin/membership`);
    await expect(reviewer.getByText("Account activation:")).toBeVisible();
    await expect(
      reviewer.getByText("Email confirmation required").first()
    ).toBeVisible();
    await expect(reviewer.getByRole("radio")).toHaveCount(0);
    await expect(
      reviewer.getByRole("button", { name: "Save account activation" })
    ).toHaveCount(0);

    // 1. Board Administration (0039) sees both options and chooses immediate activation.
    const boardContext = await browser.newContext();
    contexts.push(boardContext);
    const board = await boardContext.newPage();
    await adminLogin(board, "board-admin@example.test");
    await board.goto(`${CORE}/admin/membership`);
    const confirmOption = board.getByRole("radio", {
      name: /Email confirmation required/,
    });
    const immediateOption = board.getByRole("radio", {
      name: /Immediate activation/,
    });
    await expect(confirmOption).toBeChecked();
    await expect(immediateOption).toBeEnabled();
    await expect(
      board.getByRole("button", { name: "Save account activation" })
    ).toBeDisabled();
    await immediateOption.check();
    await expect(
      board.getByText("The email address is not verified", { exact: true })
    ).toBeVisible();
    await board
      .getByRole("button", { name: "Save account activation", exact: true })
      .click();
    await board
      .getByRole("alertdialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(board.getByText("Account activation saved")).toBeVisible();
    const [settings] =
      await db`SELECT account_activation, approval_policy FROM private.membership_settings`;
    expect(settings).toMatchObject({
      account_activation: "immediate",
      approval_policy: "automatic",
    });
    expect(
      await db`SELECT 1 FROM private.uc02_audit WHERE action = 'membership.policy_changed'
        AND changes ->> 'setting' = 'account_activation' AND changes ->> 'next' = 'immediate'`
    ).toHaveLength(1);

    // 2. Registration: approved, signed in at once, no confirmation email.
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await register(page, person.email, person.password);
    await expect(
      page.getByRole("heading", { name: "Welcome to the society" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Your membership is approved. No confirmation email is needed."
      )
    ).toBeVisible();
    await expect(
      page.getByText("You’re signed in, and your member profile is ready.")
    ).toBeVisible();
    const inbox = (await (
      await page.request.get(`${AUTH}/__test__/inbox`)
    ).json()) as { to: string }[];
    expect(inbox.filter((m) => m.to === person.email)).toHaveLength(0);
    const [row] = await db`
      SELECT a.id, a.status::text AS status, a.account_activation, a.auth_user_id = a.immediate_account_id AS created_by_core,
        (SELECT status::text FROM public.members m WHERE m.id = a.auth_user_id) AS member,
        (SELECT count(*)::int FROM public.administrative_access x WHERE x.user_id = a.auth_user_id) AS access
      FROM private.membership_applications a WHERE a.email = ${person.email}`;
    expect(row).toMatchObject({
      status: "approved",
      account_activation: "immediate",
      created_by_core: true,
      member: "member",
      access: 0,
    });

    // 3. The member profile opens straight away.
    await page.getByRole("link", { name: "Open your profile" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: person.name })
    ).toBeVisible();

    // 4. Later, elsewhere: the chosen password signs in.
    const laterContext = await browser.newContext();
    contexts.push(laterContext);
    const later = await laterContext.newPage();
    await later.goto(`${WEB}/login`);
    await later.getByLabel("Email address", { exact: true }).fill(person.email);
    await later.getByLabel("Password", { exact: true }).fill(person.password);
    await later.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      later
        .getByRole("banner")
        .getByRole("button", { name: "Open your account menu" })
    ).toContainText("IM");

    // 5. The dashboard says the address was not verified.
    await board.goto(`${CORE}/admin/membership/${row.id}`);
    await expect(
      board.getByText(/Created at registration without email verification/)
    ).toBeVisible();

    // 6. An address that already has an account: nothing is created or signed in to.
    const [before] =
      await db`SELECT id, last_sign_in_at FROM auth.users WHERE email = ${existing}`;
    const otherContext = await browser.newContext();
    contexts.push(otherContext);
    const other = await otherContext.newPage();
    await register(other, existing, "Somebody-else-password-42!");
    await expect(
      other.getByText(
        "An account with this email already exists, so no new one was created. Sign in with its password."
      )
    ).toBeVisible();
    await expect(
      other
        .getByRole("banner")
        .getByRole("button", { name: "Open your account menu" })
    ).toHaveCount(0);
    const [after] = await db`
      SELECT u.id, u.last_sign_in_at,
        (SELECT auth_user_id FROM private.membership_applications WHERE email = ${existing}) AS linked,
        (SELECT count(*)::int FROM auth.users WHERE email = ${existing}) AS accounts
      FROM auth.users u WHERE u.email = ${existing}`;
    expect(after).toMatchObject({
      id: before.id,
      last_sign_in_at: before.last_sign_in_at,
      linked: null,
      accounts: 1,
    });
    // Its own password still works on the dashboard.
    const managerContext = await browser.newContext();
    contexts.push(managerContext);
    await adminLogin(await managerContext.newPage(), existing);
  } finally {
    for (const context of contexts) await context.close();
    // Leave the shared database as the other specs expect it.
    await db`DELETE FROM private.membership_applications WHERE email = ${existing}`;
    await db`UPDATE private.membership_settings SET account_activation = 'email_confirmation'`;
    await db`DELETE FROM private.membership_submission_attempts WHERE created_at >= ${started}`;
    await db.end();
  }
});
