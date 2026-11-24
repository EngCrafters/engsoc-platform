import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

// Delegated permission management (ADR 0027) in the browser, as the owner set it up on staging:
// the Society Administrator (personal Board Administration level) creates a committee, gives it
// full access, and makes a member both its Committee Manager and its Chief. That Chief, signed in
// to the dashboard, changes another committee's permissions, a team's permissions, and grants full
// access to a committee, and (since 0040, ADR 0031) the committee their own access comes from.
const CORE = "http://127.0.0.1:3600";
const password = "Synthetic-test-password-42!";
const BOARD = "91000000-0000-4000-8000-000000000006";
const CHIEF = "91000000-0000-4000-8000-000000000002";
const CHIEF_EMAIL = "event-member@example.test";

async function adminLogin(page: Page, email: string) {
  await page.goto(`${CORE}/admin/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin/login"));
}

/** `next dev` may reload a page while compiling it; retry an aborted navigation once. */
async function open(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (error) {
    if (!String(error).includes("ERR_ABORTED")) throw error;
    await page.goto(url);
  }
}

test("a committee given full access: its Chief changes other committees, teams, full access and, since 0040, their own", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts: BrowserContext[] = [];
  const tag = randomBytes(3).toString("hex");
  // Empty until created, so the clean-up below knows what exists.
  let delegating = "";
  let target = "";
  let other = "";
  let team = "";
  try {
    // The Society Administrator's setup (Board Administration level), through the same routines.
    [{ id: delegating }] = await db`INSERT INTO public.committees (name, slug)
      VALUES (${`Delegation Board ${tag}`}, ${`delegation-${tag}`}) RETURNING id`;
    [{ id: target }] = await db`INSERT INTO public.committees (name, slug)
      VALUES (${`Delegation Target ${tag}`}, ${`delegation-target-${tag}`}) RETURNING id`;
    [{ id: other }] = await db`INSERT INTO public.committees (name, slug)
      VALUES (${`Delegation Other ${tag}`}, ${`delegation-other-${tag}`}) RETURNING id`;
    const [{ result: created }] =
      await db`SELECT private.admin_create_team(${BOARD}::uuid, ${target}::uuid, ${`Delegation Team ${tag}`}, NULL, NULL, NULL) AS result`;
    expect(created.code).toBe("SUCCESS");
    team = created.id;
    const full = (await db`SELECT key FROM private.permission_catalog`).map(
      (row) => ({ key: row.key, scope: "all" })
    );
    const [{ result: granted }] =
      await db`SELECT private.set_group_permissions(${BOARD}::uuid, ${delegating}::uuid, NULL,
        ${JSON.stringify(full)}::text::jsonb, NULL, true, NULL) AS result`;
    expect(granted.code).toBe("SUCCESS");
    await db`INSERT INTO public.administrative_access (user_id, access_level, committee_id, granted_by)
      VALUES (${CHIEF}, 'COMMITTEE_MANAGER', ${delegating}, ${BOARD})`;
    const [{ result: appointed }] =
      await db`SELECT private.assign_leadership(${BOARD}::uuid, ${CHIEF}::uuid, ${delegating}::uuid, NULL, 'chief', NULL) AS result`;
    expect(appointed.code).toBe("SUCCESS");

    // The Chief signs in and opens Administration → Permissions.
    const context = await browser.newContext();
    contexts.push(context);
    const chief = await context.newPage();
    await adminLogin(chief, CHIEF_EMAIL);
    await open(chief, `${CORE}/admin/administration/permissions`);
    await expect(
      chief.getByRole("heading", { name: "Permissions", level: 1 })
    ).toBeVisible();

    // 1. Another committee: one permission, saved.
    await open(
      chief,
      `${CORE}/admin/administration/permissions/committee/${target}`
    );
    await chief.getByLabel("View events", { exact: true }).check();
    await chief.getByRole("button", { name: "Save permissions" }).click();
    await expect(chief.getByText("Permissions saved.")).toBeVisible();

    // 2. A team of that committee (its own configuration): one permission, saved.
    await open(chief, `${CORE}/admin/administration/permissions/team/${team}`);
    await chief.getByLabel("View events", { exact: true }).check();
    await chief.getByRole("button", { name: "Save permissions" }).click();
    await expect(chief.getByText("Permissions saved.")).toBeVisible();

    // 3. Full access to a third committee, with the confirmation.
    await open(
      chief,
      `${CORE}/admin/administration/permissions/committee/${other}`
    );
    await chief.getByRole("button", { name: "Grant full access" }).click();
    await chief.getByRole("button", { name: "Save permissions" }).click();
    await expect(chief.getByRole("alertdialog")).toContainText(
      /Grant full access to/
    );
    await chief
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm and save" })
      .click();
    await expect(chief.getByText("Permissions saved.")).toBeVisible();

    const stored = await db`
      SELECT coalesce(committee_id, team_id) AS group_id, count(*)::int AS n,
        bool_and(granted_by = ${CHIEF}) AS by_chief
      FROM private.group_permissions
      WHERE committee_id IN (${target}, ${other}) OR team_id = ${team}
      GROUP BY 1`;
    const byGroup = new Map(stored.map((row) => [row.group_id, row]));
    expect(byGroup.get(target)).toMatchObject({ n: 1, by_chief: true });
    expect(byGroup.get(team)).toMatchObject({ n: 1, by_chief: true });
    expect(byGroup.get(other)).toMatchObject({
      n: full.length,
      by_chief: true,
    });

    // 4. Since 0040 (ADR 0031) their own committee is theirs to change too: the editor says the
    //    change includes their own access, and saving it applies to them on the next request.
    await open(
      chief,
      `${CORE}/admin/administration/permissions/committee/${delegating}`
    );
    await expect(
      chief.getByText(
        "You hold access through this committee: what you save here also changes your own access."
      )
    ).toBeVisible();
    await chief.getByLabel("Email Centre", { exact: true }).uncheck();
    await chief.getByRole("button", { name: "Save permissions" }).click();
    await expect(chief.getByText("Permissions saved.")).toBeVisible();
    const [own] = await db`SELECT changes FROM private.uc02_audit
      WHERE action = 'permissions.changed' AND changes ->> 'committeeId' = ${delegating}
        AND actor_user_id = ${CHIEF} ORDER BY occurred_at DESC LIMIT 1`;
    expect(own.changes).toMatchObject({ ownGroup: true });
    const [{ can }] =
      await db`SELECT private.has_permission(${CHIEF}::uuid, 'email.send') AS can`;
    expect(can).toBe(false);
  } finally {
    for (const context of contexts) await context.close();
    // Leave the shared database as the other specs expect it.
    await db`UPDATE private.leadership_appointments SET ended_at = now()
      WHERE member_id = ${CHIEF} AND ended_at IS NULL`.catch(() => undefined);
    await db`UPDATE public.administrative_access SET revoked_at = now(), revoked_by = ${BOARD}
      WHERE user_id = ${CHIEF} AND revoked_at IS NULL`.catch(() => undefined);
    for (const id of [delegating, target, other].filter(Boolean))
      await db`DELETE FROM private.group_permissions WHERE committee_id = ${id!}`.catch(
        () => undefined
      );
    if (team)
      await db`DELETE FROM private.group_permissions WHERE team_id = ${team}`.catch(
        () => undefined
      );
    await db.end();
  }
});
