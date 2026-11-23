import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

// Configurable permissions (ADR 0027), editable settings and the Email Centre (ADR 0028), in the
// browser on the local two-app harness: a fresh database, real restricted-role routines, synthetic
// Auth. With EVENT_FLOW_EMAIL=test the Email Centre sends through the recording test adapter;
// without it, sending stays off as when no provider is configured. Every person is synthetic.
const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const password = "Synthetic-test-password-42!";
const BOARD = "91000000-0000-4000-8000-000000000006";
const LEADER = "91000000-0000-4000-8000-000000000004";
const LEADER_EMAIL = "waitlist-member@example.test";
const OUTBOX = join(tmpdir(), "essqu-event-flow-email.jsonl");
const SENDING = process.env.EVENT_FLOW_EMAIL === "test";

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

/**
 * The harness runs `next dev`: the first visit to a route compiles it, and the dev client can
 * reload the page and abort a navigation in flight. Retry that once; any other failure stands.
 */
async function open(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (error) {
    if (!String(error).includes("ERR_ABORTED")) throw error;
    await page.goto(url);
  }
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );

test("committee permissions reach their leaders, settings are edited by Society Affairs, and the Email Centre works society-wide", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  if (SENDING && existsSync(OUTBOX)) rmSync(OUTBOX);
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
  const [{ id: relations }] =
    await db`SELECT id FROM public.committees WHERE slug = 'relations'`;
  try {
    // 1. Board Administration opens Administration → Permissions and configures one committee.
    const board = await context();
    await adminLogin(board, "board-admin@example.test");
    await board
      .getByRole("list", { name: "Society administration" })
      .locator('a[href="/admin/administration/permissions"]')
      .click();
    await expect(
      board.getByRole("heading", { name: "Permissions", level: 1 })
    ).toBeVisible();
    await board
      .locator(
        `a[href="/admin/administration/permissions/committee/${relations}"]`
      )
      .click();
    await expect(board.getByRole("heading", { level: 1 })).toContainText(
      "Relations"
    );
    await board.getByLabel("View events", { exact: true }).check();
    await board.getByLabel("Email Centre", { exact: true }).check();
    await board.getByLabel("Applies to").first().selectOption("own");
    await expect(board.getByText("Adds Email Centre")).toBeVisible();
    await board
      .getByLabel("Note for the audit (optional)")
      .fill("Synthetic: communications pilot.");
    await board.getByRole("button", { name: "Save permissions" }).click();
    await expect(board.getByText("Permissions saved.")).toBeVisible();
    await expect(
      board.getByText("Note: Synthetic: communications pilot.")
    ).toBeVisible();
    // Full access asks for confirmation before anything is saved.
    await board.getByRole("button", { name: "Grant full access" }).click();
    await board.getByRole("button", { name: "Save permissions" }).click();
    await expect(board.getByRole("alertdialog")).toContainText(
      /Grant full access to/
    );
    await board.getByRole("button", { name: "Cancel" }).click();
    await board.getByRole("button", { name: "Undo changes" }).click();
    const stored =
      await db`SELECT permission, scope FROM private.group_permissions WHERE committee_id = ${relations} ORDER BY permission`;
    expect(stored.map((r) => `${r.permission}:${r.scope}`)).toEqual([
      "email.send:all",
      "events.view:own",
    ]);

    // 2. An approved Chief receives exactly those permissions; nothing else opens, even by URL.
    await db`SELECT private.assign_leadership(${BOARD}::uuid, ${LEADER}::uuid, ${relations}::uuid, NULL, 'chief', NULL)`;
    const leader = await context();
    await adminLogin(leader, LEADER_EMAIL);
    await expect(
      leader.locator('a[href="/admin/communications/email"]')
    ).toBeVisible();
    await expect(
      leader.locator('a[href="/admin/events"]').first()
    ).toBeVisible();
    await expect(
      leader.getByRole("list", { name: "Society administration" })
    ).toHaveCount(0);
    await open(leader, `${CORE}/admin/administration/members`);
    await expect(
      leader.getByText("The member directory needs the View members permission")
    ).toBeVisible();
    await open(leader, `${CORE}/admin/administration/permissions`);
    await expect(
      leader.getByText("Permissions need the Manage permissions permission")
    ).toBeVisible();
    await open(leader, `${CORE}/admin/access`);
    await expect(
      leader.getByText(/available to people with the View accounts permission/)
    ).toBeVisible();

    // 3. The Email Centre: society-wide audience, bilingual message, preview, draft.
    await open(leader, `${CORE}/admin/communications/email`);
    if (!SENDING)
      await expect(leader.getByText("Sending is turned off")).toBeVisible();
    await leader.getByRole("button", { name: "New message" }).click();
    await expect(
      leader.getByRole("heading", { name: "Write a message" })
    ).toBeVisible();
    const recipients = leader.getByText(
      /eligible members?, each sent an individual message/
    );
    await expect(recipients).toBeVisible();
    await leader
      .getByRole("button", { name: "Industry Professional", exact: true })
      .click();
    await expect(
      leader.getByText(/Industry Professional · status: member/)
    ).toBeVisible();
    await leader
      .getByRole("button", { name: "Industry Professional", exact: true })
      .click();
    await leader.getByRole("button", { name: "Both", exact: true }).click();
    await leader
      .getByLabel("Subject (English)")
      .fill("Synthetic announcement for {{name}}");
    await leader
      .getByLabel("Message (English)")
      .fill(
        "Hello {{name}},\n\n**Bold** news and a [link](https://example.org).\n\n<script>alert(1)</script>"
      );
    await leader.getByLabel("الموضوع (Arabic subject)").fill("إعلان تجريبي");
    await expect(leader.getByLabel("الرسالة (Arabic message)")).toHaveAttribute(
      "dir",
      "rtl"
    );
    await leader.getByLabel("الرسالة (Arabic message)").fill("مرحباً {{name}}");
    await leader.getByRole("button", { name: "Preview message" }).click();
    const preview = leader.frameLocator('iframe[title="Message preview"]');
    await expect(preview.getByText("Hello Member Name,")).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("Bold");
    await expect(preview.getByText("<script>alert(1)</script>")).toBeVisible();
    await leader.getByRole("button", { name: "Save draft" }).click();
    await expect(leader.getByText("Draft saved.")).toBeVisible();
    const [draft] =
      await db`SELECT id, status, language, subject_ar FROM private.email_campaigns ORDER BY created_at DESC LIMIT 1`;
    expect(draft).toMatchObject({
      status: "draft",
      language: "both",
      subject_ar: "إعلان تجريبي",
    });
    const sendButton = leader.getByRole("button", {
      name: /^Send to \d+ members$/,
    });
    if (!SENDING) {
      await expect(sendButton).toBeDisabled();
    } else {
      // 4. Sending: confirmation with the exact count, background batches, individual messages.
      const label = (await sendButton.textContent()) ?? "";
      const count = Number(/Send to (\d+) members/.exec(label)?.[1]);
      expect(count).toBeGreaterThan(0);
      await sendButton.click();
      await expect(leader.getByRole("alertdialog")).toContainText(
        `Send to ${count} members?`
      );
      await leader
        .getByRole("alertdialog")
        .getByRole("button", { name: `Send to ${count} members` })
        .click();
      await expect(leader.getByText("Progress")).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(
          async () =>
            (
              await db`SELECT status FROM private.email_campaigns WHERE id = ${draft.id}`
            )[0].status,
          {
            timeout: 120_000,
          }
        )
        .toBe("completed");
      const sent = readFileSync(OUTBOX, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const ours = sent.filter((m) =>
        m.subject.startsWith("Synthetic announcement")
      );
      expect(ours).toHaveLength(count);
      expect(new Set(ours.map((m) => m.to)).size).toBe(count);
      for (const m of ours) {
        expect(m.html).not.toContain("<script>");
        expect(m.headers["List-Unsubscribe-Post"]).toBe(
          "List-Unsubscribe=One-Click"
        );
      }
      // 5. One recipient unsubscribes through the signed link.
      const link = /<([^>]+)>/.exec(ours[0].headers["List-Unsubscribe"])![1];
      const unsub = await context();
      await open(unsub, link);
      await expect(
        unsub.getByRole("heading", { name: "Unsubscribe from announcements?" })
      ).toBeVisible();
      await unsub.getByRole("button", { name: /Unsubscribe/ }).click();
      await expect(
        unsub.getByRole("heading", { name: "You are unsubscribed" })
      ).toBeVisible();
      const [{ n }] =
        await db`SELECT count(*)::int AS n FROM private.email_preferences WHERE NOT announcements`;
      expect(n).toBeGreaterThanOrEqual(1);
    }

    // 6. Society Affairs edits the verification and leadership settings through its configuration.
    const affairs = await context();
    await adminLogin(affairs, "project-reviewer@example.test");
    await open(affairs, `${CORE}/admin/membership/leadership`);
    const settings = affairs
      .locator("form")
      .filter({ has: affairs.getByLabel("Active appointments per member") });
    await affairs.getByLabel("Active appointments per member").fill("4");
    await settings.getByRole("button", { name: "Save settings" }).click();
    await expect(affairs.getByText("Settings saved")).toBeVisible();
    expect(
      (
        await db`SELECT max_active_appointments_per_member AS n FROM private.verification_settings`
      )[0].n
    ).toBe(4);
    await expect(
      affairs.getByRole("button", { name: "Save Chief, committee level" })
    ).toBeVisible();
    await affairs.reload();
    await affairs.getByLabel("Active appointments per member").fill("");
    await affairs
      .locator("form")
      .filter({ has: affairs.getByLabel("Active appointments per member") })
      .getByRole("button", { name: "Save settings" })
      .click();
    await expect(affairs.getByText("Settings saved")).toBeVisible();
    expect(
      (
        await db`SELECT max_active_appointments_per_member AS n FROM private.verification_settings`
      )[0].n
    ).toBeNull();

    // 7. The member's profile: which position gives access, and the announcements choice, in
    // English, then Arabic at phone width.
    const member = await context();
    await websiteLogin(member, LEADER_EMAIL);
    const leadership = member.getByRole("region", {
      name: "Committee leadership",
    });
    await expect(leadership.getByText(/Gives dashboard access/)).toBeVisible();
    await expect(
      leadership.getByText(/Access depends on the permissions assigned/)
    ).toBeVisible();
    const announcements = member.getByLabel(
      "Send me society announcements by email"
    );
    await expect(announcements).toBeChecked();
    await announcements.uncheck();
    await expect(
      member.getByText("You do not receive announcements.")
    ).toBeVisible();
    expect(
      (
        await db`SELECT announcements FROM private.email_preferences WHERE member_id = ${LEADER}`
      )[0].announcements
    ).toBe(false);
    const phone = await context({ viewport: { width: 390, height: 844 } });
    await websiteLogin(phone, LEADER_EMAIL);
    await phone
      .context()
      .addCookies([{ name: "es-locale", value: "ar", url: WEB }]);
    await open(phone, `${WEB}/profile`);
    await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      phone.getByRole("heading", { name: "إعلانات البريد الإلكتروني" })
    ).toBeVisible();
    await expect(
      phone.getByText(/يمنح الوصول إلى لوحة الإدارة/).first()
    ).toBeVisible();
    expect(await noHorizontalScroll(phone)).toBe(true);
    const adminPhone = await context({ viewport: { width: 390, height: 844 } });
    await adminLogin(adminPhone, "board-admin@example.test");
    await open(
      adminPhone,
      `${CORE}/admin/administration/permissions/committee/${relations}`
    );
    await expect(
      adminPhone.getByLabel("Email Centre", { exact: true })
    ).toBeChecked();
    expect(await noHorizontalScroll(adminPhone)).toBe(true);
  } finally {
    // Leave the shared fixtures as later specs expect them.
    await db`UPDATE private.leadership_appointments SET ended_at = now(), ended_by = ${BOARD}, end_reason = 'Synthetic cleanup'
      WHERE member_id = ${LEADER} AND committee_id = ${relations} AND ended_at IS NULL`.catch(
      () => undefined
    );
    await db`DELETE FROM private.group_permissions WHERE committee_id = ${relations}`.catch(
      () => undefined
    );
    await db`DELETE FROM private.email_preferences WHERE member_id = ${LEADER}`.catch(
      () => undefined
    );
    for (const c of contexts) await c.close();
    await db.end();
  }
});
