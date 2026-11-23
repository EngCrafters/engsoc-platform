import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

// Committee-level and team-level leadership and the request switch (ADR 0026, migration 0034), in
// the browser on the local two-app harness: a fresh database, real restricted-role routines,
// synthetic Auth. Every person and team is synthetic.
const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const password = "Synthetic-test-password-42!";
const MEMBER = "91000000-0000-4000-8000-000000000004";
const MEMBER_NAME = "Synthetic Waitlist Member";
const TEAM = "Synthetic Logistics Team";

async function adminLogin(page: Page, email: string) {
  await page.goto(`${CORE}/admin/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
}

async function websiteLogin(page: Page, email: string) {
  await page.goto(`${WEB}/login?next=${encodeURIComponent("/profile")}`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${WEB}/profile`);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );

test("committee and team leadership: the request switch, requests at both levels, decisions, duplicates and revocation", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts: BrowserContext[] = [];
  const context = async (options = {}) => {
    const c = await browser.newContext(options);
    contexts.push(c);
    return c.newPage();
  };
  try {
    const committeeId = async (slug: string) =>
      (await db`SELECT id FROM public.committees WHERE slug = ${slug}`)[0]
        .id as string;
    const finance = await committeeId("finance");
    const logistics = await committeeId("support-logistics");

    // 1. Board Administration finds Membership → Leadership in the sidebar and closes requests.
    const board = await context();
    await adminLogin(board, "board-admin@example.test");
    await board
      .getByRole("list", { name: "Membership" })
      .locator('a[href="/admin/membership/leadership"]')
      .click();
    await expect(board).toHaveURL(`${CORE}/admin/membership/leadership`);
    const toggle = board.getByRole("switch", {
      name: "Accept new leadership requests",
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(
      board.getByText(/Leadership requests are closed\./).first()
    ).toBeVisible();
    await expect(toggle).not.toBeChecked();
    const [{ open: afterClose }] =
      await db`SELECT leadership_requests_open AS open FROM private.verification_settings`;
    expect(afterClose).toBe(false);

    // 2. The member is told requests are closed; nothing can be sent.
    const member = await context();
    await websiteLogin(member, "waitlist-member@example.test");
    const leadership = member.getByRole("region", {
      name: "Committee leadership",
    });
    await expect(
      leadership.getByText(/Leadership requests are closed at the moment/)
    ).toBeVisible();
    await expect(
      leadership.getByRole("button", { name: "Request a leadership position" })
    ).toHaveCount(0);

    // 3. Board reopens them; the member can request again.
    await toggle.click();
    await expect(toggle).toBeChecked();
    await member.reload();
    const requestButton = leadership.getByRole("button", {
      name: "Request a leadership position",
    });
    await expect(requestButton).toBeVisible();

    // 4. A committee with no teams: committee leadership only, no team needed.
    const committeeSelect = leadership.getByLabel("Committee", { exact: true });
    const teamSelect = leadership.getByLabel("Team", { exact: true });
    const committeeLevel = leadership.getByRole("radio", {
      name: "Committee leadership",
    });
    const teamLevel = leadership.getByRole("radio", {
      name: "Team leadership",
    });
    const position = (name: string) =>
      leadership.getByRole("radio", { name, exact: true });
    await requestButton.click();
    await committeeSelect.selectOption({ label: "Finance Committee" });
    await expect(
      leadership.getByText(
        "This committee has no teams, so the position is for the committee itself."
      )
    ).toBeVisible();
    await expect(teamLevel).toHaveCount(0);
    await expect(teamSelect).toHaveCount(0);
    await position("Chief").check({ force: true });
    await leadership.getByRole("button", { name: "Send request" }).click();
    await expect(
      leadership.getByText("Your request is with the reviewers.")
    ).toBeVisible();
    await expect(
      leadership.getByText("Finance Committee → Chief", { exact: true })
    ).toBeVisible();

    // 5. A second request for the same committee level is refused by Core.
    await requestButton.click();
    await committeeSelect.selectOption({ label: "Finance Committee" });
    await position("Assistant Chief").check({ force: true });
    await leadership.getByRole("button", { name: "Send request" }).click();
    await expect(
      leadership.getByText(
        "You already have a request waiting for this committee or team."
      )
    ).toBeVisible();
    await leadership.getByRole("button", { name: "Cancel" }).click();

    // 6. Board creates a team in Support & Logistics; the committee keeps its own leaders section.
    await board.goto(`${CORE}/admin/administration/committees/${logistics}`);
    const committeeLeaders = board
      .locator("div[data-slot='card']")
      .filter({ hasText: /^Committee leaders/ });
    await expect(
      committeeLeaders.getByText("No committee leaders")
    ).toBeVisible();
    const teams = board
      .locator("div[data-slot='card']")
      .filter({ hasText: "Teams and team leaders" });
    await teams.getByRole("button", { name: "New team" }).click();
    await board.getByRole("dialog").getByLabel("Name (English)").fill(TEAM);
    await board
      .getByRole("dialog")
      .getByRole("button", { name: "Create team" })
      .click();
    await expect(board.getByText("Team created.")).toBeVisible();

    // 7. With teams, the member chooses the level; changing committee or level resets choices.
    await member.reload();
    await requestButton.click();
    await committeeSelect.selectOption({
      label: "Support & Logistics Committee",
    });
    await expect(committeeLevel).toBeVisible();
    await teamLevel.check({ force: true });
    await teamSelect.selectOption({ label: TEAM });
    await committeeLevel.check({ force: true });
    await expect(teamSelect).toHaveCount(0);
    await teamLevel.check({ force: true });
    await expect(teamSelect).toHaveValue("");
    await teamSelect.selectOption({ label: TEAM });
    await committeeSelect.selectOption({ label: "Finance Committee" });
    await expect(teamLevel).toHaveCount(0);
    await committeeSelect.selectOption({
      label: "Support & Logistics Committee",
    });
    await expect(teamLevel).not.toBeChecked();
    await expect(committeeLevel).not.toBeChecked();
    await teamLevel.check({ force: true });
    await teamSelect.selectOption({ label: TEAM });
    await position("Assistant Chief").check({ force: true });
    await leadership.getByRole("button", { name: "Send request" }).click();
    await expect(
      leadership.getByText(
        `Support & Logistics Committee → ${TEAM} → Assistant Chief`,
        { exact: true }
      )
    ).toBeVisible();
    // A committee-level position in the same committee is a separate request.
    await requestButton.click();
    await committeeSelect.selectOption({
      label: "Support & Logistics Committee",
    });
    await committeeLevel.check({ force: true });
    await position("Chief").check({ force: true });
    await leadership.getByRole("button", { name: "Send request" }).click();
    await expect(
      leadership.getByText("Support & Logistics Committee → Chief", {
        exact: true,
      })
    ).toBeVisible();

    // 8. Society Affairs reviews both levels under Membership → Leadership.
    const reviewer = await context();
    await adminLogin(reviewer, "project-reviewer@example.test");
    const decide = async (
      committee: string,
      matches: RegExp,
      decision: "Approve" | "Reject",
      reason?: string
    ) => {
      await reviewer.goto(
        `${CORE}/admin/membership/leadership?committee=${committee}`
      );
      const row = reviewer.getByRole("row").filter({ hasText: matches });
      await row.getByRole("link", { name: MEMBER_NAME, exact: true }).click();
      await reviewer.getByRole("button", { name: decision }).click();
      const dialog = reviewer.getByRole("dialog");
      if (reason) await dialog.getByLabel("Reason for the member").fill(reason);
      await dialog.getByRole("button", { name: decision }).click();
      await expect(
        reviewer.getByText(
          decision === "Approve" ? "Appointment approved" : "Request rejected"
        )
      ).toBeVisible();
    };
    await reviewer.goto(`${CORE}/admin/membership/leadership`);
    // Committee-level requests read "Committee → Position" in the queue.
    await expect(
      reviewer.getByRole("cell", {
        name: "Finance Committee → Chief",
        exact: true,
      })
    ).toBeVisible();
    await decide(finance, /Finance Committee → Chief/, "Approve");
    // The detail page names the level.
    await expect(
      reviewer.getByText("Committee leadership", { exact: true }).first()
    ).toBeVisible();
    await decide(
      logistics,
      new RegExp(`${TEAM} → Assistant Chief`),
      "Reject",
      "Synthetic: the team already has an Assistant Chief in mind."
    );
    await decide(logistics, /Support & Logistics Committee → Chief/, "Approve");

    // 9. The member sees both committee-level positions and the rejection with its reason.
    await member.reload();
    await expect(
      leadership.getByText("Finance Committee → Chief", { exact: true }).first()
    ).toBeVisible();
    await expect(
      leadership.getByText(
        "Synthetic: the team already has an Assistant Chief in mind."
      )
    ).toBeVisible();
    await expect(
      leadership.getByText(/Dashboard access: None\./)
    ).toBeVisible();
    const [{ grants }] =
      await db`SELECT count(*)::int AS grants FROM public.administrative_access WHERE user_id = ${MEMBER}`;
    expect(grants).toBe(0);
    const scopes =
      await db`SELECT team_id IS NULL AS committee_level, committee_id FROM private.leadership_appointments
        WHERE member_id = ${MEMBER} AND ended_at IS NULL ORDER BY committee_id`;
    expect(scopes.every((s) => s.committee_level)).toBe(true);

    // 10. One Chief per committee: Board cannot appoint a second, and revokes the first.
    await board.goto(`${CORE}/admin/administration/committees/${finance}`);
    await expect(
      committeeLeaders.getByText(MEMBER_NAME, { exact: true })
    ).toBeVisible();
    await committeeLeaders
      .getByRole("button", { name: "Appoint a committee leader" })
      .click();
    const appoint = board.getByRole("dialog");
    await appoint.getByLabel("Member").fill("event-member");
    await appoint.getByRole("button", { name: "Search" }).click();
    await appoint.getByRole("button", { name: "Select" }).first().click();
    await appoint.getByLabel("Position").selectOption("chief");
    await appoint.getByRole("button", { name: /^Appoint / }).click();
    await expect(
      appoint.getByText(/This position is already filled at this level/)
    ).toBeVisible();
    await appoint.getByRole("button", { name: "Cancel" }).click();
    await committeeLeaders.getByRole("button", { name: "Revoke" }).click();
    const revoke = board.getByRole("dialog");
    await revoke
      .getByLabel("Reason for the member")
      .fill("Synthetic: the term ended.");
    await revoke.getByRole("button", { name: "Revoke" }).click();
    await expect(board.getByText("Appointment revoked")).toBeVisible();
    await expect(
      committeeLeaders.getByText("No committee leaders")
    ).toBeVisible();
    await member.reload();
    await expect(
      leadership.getByText("Synthetic: the term ended.")
    ).toBeVisible();

    // 11. Arabic, right to left, at phone width, with the level choice in Arabic.
    const phone = await context({ viewport: { width: 390, height: 844 } });
    await websiteLogin(phone, "waitlist-member@example.test");
    await phone
      .context()
      .addCookies([{ name: "es-locale", value: "ar", url: WEB }]);
    await phone.goto(`${WEB}/profile`);
    await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
    const arLeadership = phone.getByRole("region", { name: "قيادة اللجان" });
    await arLeadership
      .getByRole("button", { name: "اطلب منصباً قيادياً" })
      .click();
    await arLeadership
      .getByLabel("اللجنة", { exact: true })
      .selectOption({ label: "Support & Logistics Committee" });
    await expect(
      arLeadership.getByRole("radio", { name: "قيادة اللجنة" })
    ).toBeVisible();
    await expect(
      arLeadership.getByRole("radio", { name: "قيادة فريق" })
    ).toBeVisible();
    expect(await noHorizontalScroll(phone)).toBe(true);
  } finally {
    for (const c of contexts) await c.close();
    await db.end();
  }
});
