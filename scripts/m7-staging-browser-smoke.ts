import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { loadEnv } from "vite";
import { chromium } from "playwright";

// Playwright runs outside Next.js, so load the ignored local env explicitly.
// This script never prints credentials or attendee values.
const env = loadEnv("", process.cwd(), "");
if (!env.STAGING_M5_MANAGER_EMAIL || !env.STAGING_M5_MANAGER_PASSWORD)
  throw new Error("Staging manager credentials are required in .env.local.");

const actorId = "2aa38cac-c340-4b43-8c96-04ac5d0345f3";
const baseUrl = "https://engsoc-platform.vercel.app";
const execFile = promisify(execFileCallback);
async function main() {
  const browser = await chromium.launch({ headless: true });
  const eventId = randomUUID();
  const foreignCommitteeId = randomUUID();
  const foreignEventId = randomUUID();
  async function runSql(statement: string) {
    const sqlFile = `${process.env.TEMP ?? process.cwd()}\\m7-smoke-${randomUUID()}.sql`;
    await fs.promises.writeFile(sqlFile, statement, "utf8");
    try {
      const command = `$supabase = (Get-Command supabase).Source; & $supabase db query --linked --project-ref wnrdgnmmcdedmilnzzsl --output-format json --file '${sqlFile}'`;
      const result = await execFile(
        "powershell.exe",
        ["-NoProfile", "-Command", command],
        {
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        }
      );
      return result.stdout;
    } finally {
      await fs.promises.rm(sqlFile, { force: true });
    }
  }

  async function seed() {
    await runSql(
      `DO $$ DECLARE v_committee uuid; BEGIN SELECT committee_id INTO v_committee FROM public.committee_managers WHERE user_id = '${actorId}' AND revoked_at IS NULL LIMIT 1; INSERT INTO public.events (id,title,description,event_date,location,committee_id,status,capacity) VALUES ('${eventId}','M7 browser smoke fixture','Temporary M7 smoke fixture',now() + interval '2 days','Smoke room',v_committee,'published',27); FOR i IN 0..25 LOOP INSERT INTO public.registrations (event_id,attendee_name,attendee_email,status) VALUES ('${eventId}',CASE WHEN i=0 THEN '=SUM(A1)' ELSE 'M7 Attendee ' || i::text END,'m7-smoke-${eventId}-' || i::text || '@example.test','confirmed'); END LOOP; INSERT INTO public.registrations (event_id,attendee_name,attendee_email,status) VALUES ('${eventId}','M7 Waitlisted','m7-wait-${eventId}@example.test','waitlisted'); INSERT INTO public.committees (id,name) VALUES ('${foreignCommitteeId}','M7 Foreign Smoke Committee'); INSERT INTO public.events (id,title,description,event_date,location,committee_id,status) VALUES ('${foreignEventId}','M7 Foreign Smoke Event','Temporary foreign fixture',now() + interval '2 days','Smoke room','${foreignCommitteeId}','published'); END $$;`
    );
  }

  async function cleanup() {
    await runSql(
      `delete from private.uc02_audit where event_id in ('${eventId}','${foreignEventId}'); delete from public.registrations where event_id = '${eventId}'; delete from public.events where id in ('${eventId}','${foreignEventId}'); delete from public.committees where id = '${foreignCommitteeId}';`
    );
  }

  async function login(page: import("playwright").Page) {
    await page.goto(`${baseUrl}/admin/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email address").fill(env.STAGING_M5_MANAGER_EMAIL);
    await page.getByLabel("Password").fill(env.STAGING_M5_MANAGER_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/admin\/events/, { timeout: 20_000 });
  }

  try {
    await seed();
    const seededCounts = await runSql(
      "select json_build_object('confirmed', count(*) filter (where r.status = 'confirmed'), 'waitlisted', count(*) filter (where r.status = 'waitlisted')) from public.registrations r where r.event_id = '" +
        eventId +
        "'"
    );
    const seededScope = await runSql(
      "select json_build_object('foreign_is_distinct', e.committee_id <> cm.committee_id, 'manager_has_foreign', exists (select 1 from public.committee_managers cm2 where cm2.user_id = '" +
        actorId +
        "' and cm2.committee_id = e.committee_id and cm2.revoked_at is null)) from public.events e join public.committee_managers cm on cm.user_id = '" +
        actorId +
        "' where e.id = '" +
        foreignEventId +
        "' limit 1"
    );
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await login(desktop);
    await desktop.goto(`${baseUrl}/admin/events/${eventId}/registrations`, {
      waitUntil: "networkidle",
    });
    const confirmedCount = await desktop
      .getByText("Confirmed", { exact: true })
      .count();
    const confirmedBody = await desktop.locator("body").innerText();
    const firstPage =
      confirmedBody.includes("M7 Attendee 1") &&
      confirmedBody.includes("Next page");
    const downloadPromise = desktop.waitForEvent("download");
    await desktop.locator("form[action*='/export'] button").click();
    const download = await downloadPromise;
    const csv = await fs.promises.readFile(
      (await download.path()) as string,
      "utf8"
    );
    const csvSafe = csv.includes("'=SUM(A1)") && !csv.includes(foreignEventId);
    await desktop.goto(
      `${baseUrl}/admin/events/${eventId}/registrations?status=waitlisted`,
      { waitUntil: "networkidle" }
    );
    await desktop.waitForLoadState("networkidle");
    const waitlistedBody = await desktop.locator("body").innerText();
    const waitlistedBefore = waitlistedBody.includes("M7 Waitlisted");
    const waitlistedUrl = desktop.url();
    await desktop.getByRole("button", { name: "Promote" }).click();
    await desktop.waitForLoadState("networkidle");
    await desktop.reload({ waitUntil: "networkidle" });
    const promotedBody = await desktop.locator("body").innerText();
    const promoted = !promotedBody.includes("M7 Waitlisted");
    const foreign = await desktop.goto(
      `${baseUrl}/admin/events/${foreignEventId}/registrations`,
      { waitUntil: "networkidle" }
    );
    const foreignBody = await desktop.locator("body").innerText();
    const foreignDenied =
      foreign?.status() === 404 ||
      (!foreignBody.includes("M7 Foreign Smoke Event") &&
        !foreignBody.toLowerCase().includes("registrations"));
    const malformed = await desktop.goto(
      `${baseUrl}/admin/events/${eventId}/registrations?status=waitlisted&cursor=bad`,
      { waitUntil: "networkidle" }
    );
    const malformedSafe =
      malformed?.status() === 200 &&
      (await desktop.locator("body").innerText()).includes("invalid");
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await login(mobile);
    await mobile.goto(`${baseUrl}/admin/events/${eventId}/registrations`, {
      waitUntil: "networkidle",
    });
    const mobileUsable = await mobile
      .getByRole("heading", { name: /registrations/i })
      .isVisible();
    await mobile.goto(`${baseUrl}/admin/account`, { waitUntil: "networkidle" });
    const accountBody = await mobile.locator("body").innerText();
    const maintenanceAbsent = !/\b(grant|revoke)\b/i.test(accountBody);
    console.log(
      JSON.stringify({
        authenticated: true,
        confirmedCountControlVisible: confirmedCount > 0,
        firstPage,
        firstPageStatus: await desktop.url(),
        seededWaitlistPresent:
          seededCounts.includes("waitlisted") && seededCounts.includes("1"),
        seededForeignScopeSafe:
          seededScope.includes("foreign_is_distinct") &&
          seededScope.includes("true") &&
          seededScope.includes("manager_has_foreign") &&
          seededScope.includes("false"),
        waitlistedUrl,
        waitlistedEmptyState: waitlistedBody.includes("No registrations yet"),
        csvSafe,
        waitlistedBefore,
        promoted,
        foreignDenied,
        foreignStatus: foreign?.status() ?? null,
        foreignHasRegistrationHeading: foreignBody
          .toLowerCase()
          .includes("registrations"),
        foreignHasNotFound: foreignBody.toLowerCase().includes("not found"),
        promotionErrorShown: promotedBody.toLowerCase().includes("could not"),
        maintenanceAbsent,
        malformedSafe,
        mobileUsable,
      })
    );
  } finally {
    await cleanup();
    await browser.close();
  }
}
main();
