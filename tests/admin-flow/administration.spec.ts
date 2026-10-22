import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const CORE = "http://127.0.0.1:3600";
const password = "Synthetic-test-password-42!";
const MEMBER = "91000000-0000-4000-8000-000000000002";
const WAITLIST_MEMBER = "91000000-0000-4000-8000-000000000004";
const ERASE_MEMBER = "91000000-0000-4000-8000-000000000008";
const text = (en: string) => ({ en, ar: "" });

async function adminLogin(page: Page, email: string) {
  await page.goto(`${CORE}/admin/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
}

const db = () =>
  postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 2 });

test.describe.configure({ mode: "serial" });

test("committee managers never reach administration", async ({ page }) => {
  await adminLogin(page, "event-manager@example.test");
  await expect(
    page.getByRole("navigation").getByText("Society administration")
  ).toHaveCount(0);
  await page.goto(`${CORE}/admin/administration`);
  await expect(
    page.getByText("Administration is for senior administrators")
  ).toBeVisible();
  await page.goto(`${CORE}/admin/administration/members`);
  await expect(
    page.getByText("The member directory is for senior administrators")
  ).toBeVisible();
  await page.goto(`${CORE}/admin/access`);
  await expect(
    page.getByText(
      "Accounts and access are managed by Board Administration and the Technical Team."
    )
  ).toBeVisible();
});

test("Board Administration runs a committee: create, roster, manager lifecycle, archive", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const sql = db();
  try {
    await adminLogin(page, "board-admin@example.test");
    await page.goto(`${CORE}/admin/administration`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Administration" })
    ).toBeVisible();
    await expect(page.getByText("Permissions", { exact: true })).toBeVisible();

    // Create, then edit.
    await page.goto(`${CORE}/admin/administration/committees`);
    await page.getByRole("button", { name: "New committee" }).click();
    await page.getByLabel("Name").fill("Synthetic Outreach Committee");
    await expect(page.getByLabel("Identifier")).toHaveValue(
      "synthetic-outreach-committee"
    );
    await page.getByLabel("Responsibilities").fill("Runs synthetic outreach.");
    await page.getByRole("button", { name: "Create committee" }).click();
    await page.waitForURL(
      /\/admin\/administration\/committees\/[0-9a-f-]{36}$/
    );
    const committeeId = page.url().split("/").at(-1)!;
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Synthetic Outreach Committee",
      })
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.getByLabel("Identifier")).toHaveAttribute("readonly", "");
    await page
      .getByLabel("Responsibilities")
      .fill("Runs synthetic outreach and visits.");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(
      page.locator("p", { hasText: "Runs synthetic outreach and visits." })
    ).toBeVisible();

    // Roster: a member with a responsibility, which grants nothing.
    await page.getByLabel("Add a member").fill("Synthetic Member");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("list", { name: "Search results" })
      .getByRole("listitem")
      .filter({ hasText: "event-member@example.test" })
      .getByRole("button", { name: "Select" })
      .click();
    await page.getByLabel(/Responsibility for/).fill("Logistics lead");
    await page.getByRole("button", { name: "Add to committee" }).click();
    await expect(
      page.getByRole("cell", { name: "Logistics lead" })
    ).toBeVisible();
    const [grant] =
      await sql`SELECT count(*)::int AS n FROM public.administrative_access WHERE user_id = ${MEMBER}`;
    expect(grant.n).toBe(0);

    // Manager: assign, suspend, reactivate.
    await page.getByRole("button", { name: "Assign manager" }).click();
    await page
      .getByRole("textbox", { name: "Account" })
      .fill("waitlist-member");
    await page
      .getByRole("button", { name: "waitlist-member@example.test" })
      .click();
    await page
      .getByRole("button", { name: "Assign waitlist-member@example.test" })
      .click();
    const managers = page.locator("li", {
      hasText: "waitlist-member@example.test",
    });
    await expect(managers.getByText("Active", { exact: true })).toBeVisible();
    const actions = () =>
      page
        .getByRole("button", {
          name: "Actions for waitlist-member@example.test",
        })
        .click();
    await actions();
    await page.getByRole("menuitem", { name: "Suspend access" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Suspend access" })
      .click();
    await expect(
      managers.getByText("Suspended", { exact: true })
    ).toBeVisible();
    const [suspended] =
      await sql`SELECT revoked_at, revocation_kind FROM public.administrative_access WHERE user_id = ${WAITLIST_MEMBER}`;
    expect(suspended.revocation_kind).toBe("suspended");
    await actions();
    await page.getByRole("menuitem", { name: "Reactivate access" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reactivate access" })
      .click();
    await expect(managers.getByText("Active", { exact: true })).toBeVisible();

    // An active manager blocks archiving; revoked, the committee archives and restores.
    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archive committee" }).click();
    await expect(
      page.getByText("1 active manager must be revoked or reassigned first.")
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await actions();
    await page.getByRole("menuitem", { name: "Revoke manager access" }).click();
    await page.getByRole("button", { name: "Confirm revocation" }).click();
    await expect(managers.getByText("Revoked", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archive committee" }).click();
    await expect(page.getByText(/^Archived/).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Assign manager" })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Restore committee" }).click();
    await expect(
      page.getByText("Active", { exact: true }).first()
    ).toBeVisible();
    const audit =
      await sql`SELECT action FROM private.uc02_audit WHERE committee_id = ${committeeId} ORDER BY occurred_at`;
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "committee.created",
        "committee.updated",
        "committee.member_added",
        "manager.assigned",
        "access.suspended",
        "access.reactivated",
        "manager.revoked",
        "committee.archived",
        "committee.restored",
      ])
    );

    // Board's limits: no senior roles, no credentials, no account deletion.
    await page.goto(`${CORE}/admin/access`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Accounts & access" })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Actions for technical-admin@example.test" })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Managed by the Technical Team" })
    ).toBeDisabled();
    await expect(
      page.getByRole("menuitem", { name: "Delete account permanently" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Set temporary password" })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto(`${CORE}/admin/administration/members/${ERASE_MEMBER}`);
    await expect(
      page.getByRole("button", { name: "Delete membership" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete account" })
    ).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test("the Technical Team deletes events, projects, memberships and accounts permanently", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const sql = db();
  try {
    const [{ id: media }] =
      await sql`SELECT id FROM public.committees WHERE slug = 'media'`;
    const [{ id: affairs }] =
      await sql`SELECT id FROM public.committees WHERE slug = 'society-affairs'`;
    const archived = randomUUID();
    const live = randomUUID();
    const cover = `event-covers/${randomUUID()}.png`;
    await sql`INSERT INTO public.events (id, title, description, event_date, committee_id, status, archived_at, cover_image_key)
      VALUES (${archived}, 'Synthetic archived event', 'Old.', now() - interval '10 days', ${media}, 'published', now(), ${cover}),
             (${live}, 'Synthetic live event', 'Now.', now() + interval '10 days', ${media}, 'published', NULL, NULL)`;
    await sql`INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
      VALUES (${archived}, 'Guest One', 'guest.one@example.test', 'confirmed'),
             (${archived}, 'Guest Two', 'guest.two@example.test', 'waitlisted')`;
    const content = {
      title: text("Synthetic doomed project"),
      summary: text("Summary."),
      discipline: "electrical",
      alsoDisciplines: [],
      year: 2026,
      type: "research",
      stage: "testing",
      technologies: [],
      problem: text("Problem."),
      solution: text("Solution."),
      technicalApproach: { overview: text("Overview."), decisions: [] },
      development: [],
      validation: [],
      nextSteps: text("Next."),
      collaboration: { seeking: text(""), application: text("") },
      parts: [],
      achievements: [],
      team: [],
      links: [],
      mediaIds: [],
    };
    const [project] =
      await sql`INSERT INTO private.projects (member_id, committee_id, content, status) VALUES (${MEMBER}, ${affairs}, ${sql.json(content)}, 'submitted') RETURNING id`;
    await sql`INSERT INTO private.project_history (project_id, actor_id, revision, action) VALUES (${project.id}, ${MEMBER}, 1, 'created')`;

    await adminLogin(page, "technical-admin@example.test");
    const dialog = page.getByRole("alertdialog");

    // A live event is blocked, with the reason.
    await page.goto(`${CORE}/admin/events/${live}`);
    await page.getByRole("tab", { name: "Lifecycle" }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(
      dialog.getByText("Permanent deletion is blocked")
    ).toBeVisible();
    await expect(dialog.getByText(/The event is live/)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Delete permanently" })
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();

    // The archived one goes, with its registrations; the audit keeps the history.
    await page.goto(`${CORE}/admin/events/${archived}`);
    await page.getByRole("tab", { name: "Lifecycle" }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(dialog.getByText(/2 registrations with names/)).toBeVisible();
    const confirmDelete = dialog.getByRole("button", {
      name: "Delete permanently",
    });
    await expect(confirmDelete).toBeDisabled();
    await dialog
      .getByLabel(/Type the event title/)
      .fill("Synthetic archived event");
    await confirmDelete.click();
    await page.waitForURL(`${CORE}/admin/events`);
    expect(
      await sql`SELECT 1 FROM public.events WHERE id = ${archived}`
    ).toHaveLength(0);
    expect(
      await sql`SELECT 1 FROM public.registrations WHERE event_id = ${archived}`
    ).toHaveLength(0);
    expect(
      await sql`SELECT 1 FROM private.uc02_audit WHERE event_id = ${archived} AND action = 'event.deleted'`
    ).toHaveLength(1);
    await expect
      .poll(
        async () =>
          (
            await sql`SELECT completed_at IS NOT NULL AS done FROM private.membership_storage_deletions WHERE storage_key = ${cover}`
          )[0]?.done
      )
      .toBe(true);

    // A project.
    await page.goto(`${CORE}/admin/projects/${project.id}`);
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await dialog
      .getByLabel(/Type the project title/)
      .fill("Synthetic doomed project");
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL(`${CORE}/admin/projects`);
    expect(
      await sql`SELECT 1 FROM private.projects WHERE id = ${project.id}`
    ).toHaveLength(0);

    // A membership record: password re-entered; the sign-in account remains.
    await page.goto(`${CORE}/admin/administration/members/${WAITLIST_MEMBER}`);
    await page.getByRole("button", { name: "Delete membership" }).click();
    await dialog
      .getByLabel(/Type the membership email/)
      .fill("waitlist-member@example.test");
    await dialog.getByLabel("Your password").fill("wrong-password-123");
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expect(
      dialog.getByText("Your password is not correct.")
    ).toBeVisible();
    await dialog.getByLabel("Your password").fill(password);
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL(`${CORE}/admin/administration/members`);
    expect(
      await sql`SELECT 1 FROM public.members WHERE id = ${WAITLIST_MEMBER}`
    ).toHaveLength(0);
    expect(
      await sql`SELECT 1 FROM auth.users WHERE id = ${WAITLIST_MEMBER}`
    ).toHaveLength(1);

    // A complete account: data, grant history, audit identity and the Auth identity.
    await page.goto(`${CORE}/admin/administration/members/${ERASE_MEMBER}`);
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(
      dialog.getByText(/is deleted from Supabase Auth/)
    ).toBeVisible();
    await dialog
      .getByLabel(/Type the sign-in email/)
      .fill("erase-member@example.test");
    await dialog.getByLabel("Your password").fill(password);
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL(`${CORE}/admin/administration/members`);
    expect(
      await sql`SELECT 1 FROM public.members WHERE id = ${ERASE_MEMBER}`
    ).toHaveLength(0);
    expect(
      await sql`SELECT 1 FROM auth.users WHERE id = ${ERASE_MEMBER}`
    ).toHaveLength(0);
    expect(await sql`SELECT 1 FROM private.account_erasures`).toHaveLength(0);
    expect(
      await sql`SELECT 1 FROM private.uc02_audit WHERE action = 'account.erased'`
    ).toHaveLength(1);

    // The overview records it all.
    await page.goto(`${CORE}/admin/administration`);
    await expect(
      page.getByText("Event deleted permanently").first()
    ).toBeVisible();
    await expect(page.getByText("Account erased").first()).toBeVisible();
  } finally {
    await sql.end();
  }
});
