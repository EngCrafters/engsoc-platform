import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import sharp from "sharp";
import postgres from "postgres";

// Development Cycle 2 (ADR 0025) in the browser, on the local two-app harness: a fresh database,
// real restricted-role routines, synthetic Auth and S3. Every person, file and team is synthetic.
const CORE = "http://127.0.0.1:3600";
const WEB = "http://127.0.0.1:3601";
const password = "Synthetic-test-password-42!";
const MEMBER = "91000000-0000-4000-8000-000000000002";
const MEMBER_NAME = "Synthetic Member";
const TEAM = "Synthetic Development Team";
const TEAM_AR = "فريق التطوير التجريبي";

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

/** One applicant in a fresh browser, so no earlier application is remembered. */
async function apply(
  browser: Browser,
  contexts: BrowserContext[],
  applicant: {
    name: string;
    email: string;
    category: string;
    fill?: (page: Page) => Promise<void>;
  }
) {
  const context = await browser.newContext();
  contexts.push(context);
  const web = await context.newPage();
  await web.goto(`${WEB}/register`);
  await web.getByLabel("Full name", { exact: true }).fill(applicant.name);
  await web.getByLabel("Email address", { exact: true }).fill(applicant.email);
  await web
    .getByRole("radio", { name: applicant.category, exact: true })
    .check({ force: true }); // a styled chip: its label text takes the click
  await applicant.fill?.(web);
  await web.getByLabel("Discipline", { exact: true }).selectOption("civil");
  await web.getByLabel("Password", { exact: true }).fill(password);
  await web.getByLabel("Confirm password", { exact: true }).fill(password);
  await web.getByLabel(/I confirm that these details are mine/).check();
  await web
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect(
    web.getByRole("heading", { name: "Application received" })
  ).toBeVisible();
  return web;
}

test("register in every category, verify an SQU student through rejection and resubmission, appoint a leader, revoke — in English, Arabic and on a phone", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const db = postgres(process.env.TEST_DATABASE_URL!, {
    prepare: false,
    max: 2,
  });
  const contexts: BrowserContext[] = [];
  try {
    // This flow is about verification and leadership, not approval: it keeps the unset policy it
    // was written for (0037 makes `automatic` the default; ADR 0029 has its own flow).
    await db`UPDATE private.membership_settings SET approval_policy=NULL`;
    // 1. Registration in the four categories the profile flow does not use (it registers a
    //    University Student at SQU): personal email, no student ID, no ID card. Fields typed for
    //    another category are cleared when the category changes, and never block the form.
    await apply(browser, contexts, {
      name: "Synthetic Industry Applicant",
      email: "industry.applicant@example.org",
      category: "Industry Professional",
      fill: async (web) => {
        await web
          .getByRole("radio", { name: "University Student", exact: true })
          .check({ force: true });
        await web
          .getByLabel("University", { exact: true })
          .selectOption("other");
        await web
          .getByLabel("University name", { exact: true })
          .fill("Synthetic Technical University");
        await web
          .getByLabel("Academic year", { exact: true })
          .selectOption("3");
        await expect(
          web.getByText("Synthetic Technical University")
        ).toBeVisible();
        await web
          .getByRole("radio", { name: "Industry Professional", exact: true })
          .check({ force: true });
        await expect(web.getByLabel("University", { exact: true })).toHaveCount(
          0
        );
        await expect(
          web.getByLabel("Academic year", { exact: true })
        ).toHaveCount(0);
        await expect(
          web.getByText("Synthetic Technical University")
        ).toHaveCount(0);
      },
    });
    await apply(browser, contexts, {
      name: "Synthetic Graduate Applicant",
      email: "graduate.applicant@example.org",
      category: "Graduate / Alumni",
      fill: async (web) => {
        // The alma mater is optional, and "Other university" takes a typed name.
        await expect(web.getByLabel("Academic year")).toHaveCount(0);
        await web
          .getByLabel("Alma mater (optional)", { exact: true })
          .selectOption("other");
        await web
          .getByLabel("University name", { exact: true })
          .fill("Synthetic Overseas University");
      },
    });
    await apply(browser, contexts, {
      name: "Synthetic Academic Applicant",
      email: "academic.applicant@example.org",
      category: "Academic / Researcher",
      fill: async (web) => {
        await expect(web.getByLabel("University", { exact: true })).toHaveCount(
          0
        );
      },
    });
    await apply(browser, contexts, {
      name: "Synthetic Other Applicant",
      email: "other.applicant@example.org",
      category: "Other",
    });
    const applications =
      await db`SELECT email, category, institution_id, institution_name, academic_year, university_id,
          (SELECT count(*)::int FROM private.membership_documents d WHERE d.application_id = a.id) AS documents
        FROM private.membership_applications a
        WHERE email IN ('industry.applicant@example.org', 'graduate.applicant@example.org',
          'academic.applicant@example.org', 'other.applicant@example.org')
        ORDER BY email`;
    expect(applications).toEqual([
      {
        email: "academic.applicant@example.org",
        category: "academic",
        institution_id: null,
        institution_name: null,
        academic_year: null,
        university_id: null,
        documents: 0,
      },
      {
        email: "graduate.applicant@example.org",
        category: "graduate",
        institution_id: null,
        institution_name: "Synthetic Overseas University",
        academic_year: null,
        university_id: null,
        documents: 0,
      },
      {
        email: "industry.applicant@example.org",
        category: "industry_professional",
        institution_id: null,
        institution_name: null,
        academic_year: null,
        university_id: null,
        documents: 0,
      },
      {
        email: "other.applicant@example.org",
        category: "other",
        institution_id: null,
        institution_name: null,
        academic_year: null,
        university_id: null,
        documents: 0,
      },
    ]);

    // 2. Board Administration creates a team under an existing committee. Technical sees the
    //    team but holds no appointment authority.
    const boardContext = await browser.newContext();
    contexts.push(boardContext);
    const board = await boardContext.newPage();
    await adminLogin(board, "board-admin@example.test");
    const [media] =
      await db`SELECT id FROM public.committees WHERE slug = 'media'`;
    await board.goto(`${CORE}/admin/administration/committees/${media.id}`);
    const teams = board
      .locator("div[data-slot='card']")
      .filter({ hasText: "Teams and team leaders" });
    await expect(teams.getByText("No teams", { exact: true })).toBeVisible();
    await teams.getByRole("button", { name: "New team" }).click();
    const teamDialog = board.getByRole("dialog");
    await teamDialog.getByLabel("Name (English)").fill(TEAM);
    await teamDialog.getByLabel("Name (Arabic)").fill(TEAM_AR);
    await teamDialog
      .getByLabel("Description (English)")
      .fill("Builds synthetic things.");
    await teamDialog.getByRole("button", { name: "Create team" }).click();
    await expect(board.getByText("Team created.")).toBeVisible();
    await expect(teams.getByText(TEAM, { exact: true })).toBeVisible();
    await expect(teams.getByText(TEAM_AR)).toHaveAttribute("dir", "rtl");
    await expect(
      teams.getByRole("button", { name: /Appoint/ }).first()
    ).toBeVisible();

    const technicalContext = await browser.newContext();
    contexts.push(technicalContext);
    const technical = await technicalContext.newPage();
    await adminLogin(technical, "technical-admin@example.test");
    await technical.goto(`${CORE}/admin/administration/committees/${media.id}`);
    const technicalTeams = technical
      .locator("div[data-slot='card']")
      .filter({ hasText: "Teams and team leaders" });
    await expect(technicalTeams.getByText(TEAM, { exact: true })).toBeVisible();
    await expect(
      technicalTeams.getByText(
        /people with the leadership permissions for this committee/
      )
    ).toBeVisible();
    await expect(
      technicalTeams.getByRole("button", { name: /Appoint/ })
    ).toHaveCount(0);
    for (const queue of ["verifications", "leadership"]) {
      await technical.goto(`${CORE}/admin/membership/${queue}`);
      await expect(technical.getByText("Settings only")).toBeVisible();
      await expect(
        technical.getByText(
          /Their committee or team permissions decide who else may/
        )
      ).toBeVisible();
    }

    // 3. The profile's two cards load independently. With the leadership routine unavailable
    //    (as on a database without migration 0033), only that card fails, with a reference that
    //    names the failing request in Core's log; SQU verification still works.
    await db`REVOKE EXECUTE ON FUNCTION private.get_own_leadership(uuid) FROM app_runtime`;
    const memberContext = await browser.newContext();
    contexts.push(memberContext);
    const member = await memberContext.newPage();
    let leadershipFailures = 0;
    member.on("response", (response) => {
      if (
        response.url() === `${CORE}/v1/me/leadership` &&
        response.request().method() === "GET" &&
        response.status() === 503
      )
        leadershipFailures += 1;
    });
    await websiteLogin(member, "event-member@example.test");
    await expect(
      member.getByRole("heading", { name: "Verification & Society Roles" })
    ).toHaveCount(0);
    const squ = member.getByRole("region", {
      name: "SQU student verification",
    });
    const leadership = member.getByRole("region", {
      name: "Committee leadership",
    });
    await expect(squ.getByText("Not verified")).toBeVisible();
    await expect(
      squ.getByText("You have not asked for SQU verification. It is optional.")
    ).toBeVisible();
    const failure = leadership.getByRole("alert");
    await expect(failure).toContainText(
      "Your committee positions and requests could not be loaded right now."
    );
    const reference = (
      await failure.locator("bdi").textContent()
    )?.trim() as string;
    expect(reference).toMatch(/^[0-9a-f-]{8}$/);
    expect(leadershipFailures).toBeGreaterThan(0);
    await expect
      .poll(() => {
        try {
          return readFileSync(
            join(tmpdir(), "essqu-event-flow-core.log"),
            "utf8"
          );
        } catch {
          return "";
        }
      })
      .toMatch(
        // Logged as `member_leadership_failed {\n  requestId: '…', name, code }`.
        new RegExp(`member_leadership_failed \\{\\s+requestId: '${reference}`)
      );
    await db`GRANT EXECUTE ON FUNCTION private.get_own_leadership(uuid) TO app_runtime`;
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(
      leadership.getByText("You hold no position and have no requests.")
    ).toBeVisible();
    await expect(
      leadership.getByText(/Dashboard access: None\./)
    ).toBeVisible();

    // 4. The member submits SQU evidence and requests a position.
    await squ.getByRole("button", { name: "Submit for verification" }).click();
    await expect(
      squ.getByText("Enter your SQU student number: 6 to 10 digits.")
    ).toBeVisible();
    const card = await sharp({
      create: { width: 640, height: 400, channels: 3, background: "#e8eef9" },
    })
      .png()
      .toBuffer();
    const sendEvidence = async () => {
      await squ.getByLabel("SQU student number").fill("20231234");
      await squ.locator('input[type="file"]').setInputFiles({
        name: "synthetic-card.png",
        mimeType: "image/png",
        buffer: card,
      });
      await expect(squ.getByText(/Ready to send/)).toBeVisible();
      await squ
        .getByRole("button", { name: "Submit for verification" })
        .click();
      await expect(
        squ.getByText("Your evidence is with the reviewers.")
      ).toBeVisible();
      await expect(squ.getByText("Pending review").first()).toBeVisible();
      await expect(squ.getByLabel("SQU student number")).toHaveCount(0);
    };
    await sendEvidence();

    await leadership
      .getByRole("button", { name: "Request a leadership position" })
      .click();
    const committeeSelect = leadership.getByLabel("Committee", {
      exact: true,
    });
    const teamSelect = leadership.getByLabel("Team", { exact: true });
    const teamLevel = leadership.getByRole("radio", {
      name: "Team leadership",
    });
    // Team leadership is offered once a committee with teams is chosen.
    await expect(teamSelect).toHaveCount(0);
    await committeeSelect.selectOption({ label: "Media Committee" });
    await teamLevel.check({ force: true }); // a styled chip
    await teamSelect.selectOption({ label: TEAM });
    // Changing the committee starts the level and the team again.
    await committeeSelect.selectOption("");
    await expect(teamSelect).toHaveCount(0);
    await committeeSelect.selectOption({ label: "Media Committee" });
    await expect(teamLevel).not.toBeChecked();
    await teamLevel.check({ force: true });
    await expect(teamSelect).toHaveValue("");
    await teamSelect.selectOption({ label: TEAM });
    await leadership
      .getByRole("radio", { name: "Chief", exact: true })
      .check({ force: true }); // a styled chip, like the category
    await leadership.getByRole("button", { name: "Send request" }).click();
    await expect(
      leadership.getByText("Your request is with the reviewers.")
    ).toBeVisible();
    await expect(leadership.getByText("Pending review")).toBeVisible();
    await expect(
      leadership.getByText(`Media Committee → ${TEAM} → Chief`)
    ).toBeVisible();

    // 5. Society Affairs rejects the evidence with a reason the member sees.
    const reviewerContext = await browser.newContext();
    contexts.push(reviewerContext);
    const reviewer = await reviewerContext.newPage();
    await adminLogin(reviewer, "project-reviewer@example.test");
    await reviewer.goto(`${CORE}/admin/membership`);
    await expect(
      reviewer.getByRole("navigation", { name: "Membership review queues" })
    ).toContainText("SQU verification");
    await reviewer
      .getByRole("link", { name: /SQU verification/ })
      .first()
      .click();
    // ADR 0027: reviewers are described by what they may do, not by their committee.
    await expect(reviewer.getByText("Reviewer", { exact: true })).toBeVisible();
    await reviewer
      .getByRole("link", { name: MEMBER_NAME, exact: true })
      .click();
    await expect(reviewer.getByText("20231234")).toBeVisible();
    await reviewer.getByRole("button", { name: "Show ID card" }).click();
    const image = reviewer.getByAltText("Applicant's SQU student ID card");
    await expect(image).toBeVisible();
    // Decoded, not just present: the route served a real image.
    await expect
      .poll(() =>
        image.evaluate((img: HTMLImageElement) =>
          img.complete ? img.naturalWidth : 0
        )
      )
      .toBeGreaterThan(0);
    const firstRequest = reviewer.url().split("/").pop()!;
    await reviewer.getByRole("button", { name: "Reject" }).click();
    const reject = reviewer.getByRole("dialog");
    await reject
      .getByLabel("Reason for the member")
      .fill("Synthetic: the card photo is blurred.");
    await reject.getByRole("button", { name: "Reject" }).click();
    await expect(reviewer.getByText("Request rejected")).toBeVisible();

    // 6. The evidence stays private: no session, and Technical access, both get nothing.
    const documentPath = `${CORE}/admin/membership/verifications/${firstRequest}/document`;
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    expect((await anonymous.request.get(documentPath)).status()).toBe(401);
    expect((await technicalContext.request.get(documentPath)).status()).toBe(
      404
    );
    const viewed = await reviewerContext.request.get(documentPath);
    expect(viewed.status()).toBe(200);
    expect(viewed.headers()["cache-control"]).toContain("no-store");

    // 7. The member sees the reason and resubmits corrected evidence.
    await member.reload();
    await expect(squ.getByText("Not approved").first()).toBeVisible();
    await expect(
      squ.getByText("Synthetic: the card photo is blurred.")
    ).toBeVisible();
    await expect(
      squ.getByText("You can submit corrected evidence below.")
    ).toBeVisible();
    await sendEvidence();

    // 8. Board Administration verifies the resubmission; Society Affairs approves the position.
    await board.goto(`${CORE}/admin/membership/verifications`);
    await expect(board.getByText("Reviewer", { exact: true })).toBeVisible();
    await board.getByRole("link", { name: MEMBER_NAME, exact: true }).click();
    await board.getByRole("button", { name: "Show ID card" }).click();
    await expect(
      board.getByAltText("Applicant's SQU student ID card")
    ).toBeVisible();
    await board.getByRole("button", { name: "Verify as SQU student" }).click();
    await board
      .getByRole("dialog")
      .getByRole("button", { name: "Verify as SQU student" })
      .click();
    await expect(board.getByText("Member verified")).toBeVisible();

    await reviewer.goto(`${CORE}/admin/membership/leadership`);
    await reviewer
      .getByRole("link", { name: MEMBER_NAME, exact: true })
      .click();
    await expect(reviewer.getByText("Vacant")).toBeVisible();
    await reviewer.getByRole("button", { name: "Approve" }).click();
    await reviewer
      .getByRole("dialog")
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(reviewer.getByText("Appointment approved")).toBeVisible();

    // 9. The member sees the badge and the appointment; neither grants dashboard access.
    await member.reload();
    await expect(
      member.getByRole("link", { name: "SQU Verified" })
    ).toBeVisible();
    await expect(squ.getByText("SQU Verified")).toBeVisible();
    await expect(
      leadership.getByText(`Media Committee → ${TEAM} → Chief`).first()
    ).toBeVisible();
    await expect(
      leadership.getByText(/Dashboard access: None\./)
    ).toBeVisible();
    const [{ grants }] =
      await db`SELECT count(*)::int AS grants FROM public.administrative_access WHERE user_id = ${MEMBER}`;
    expect(grants).toBe(0);
    await board.goto(`${CORE}/admin/administration/committees/${media.id}`);
    await expect(teams.getByText(MEMBER_NAME, { exact: true })).toBeVisible();
    await expect(
      teams.getByRole("button", { name: "Revoke" }).first()
    ).toBeVisible();
    // Technical last visited the leadership queue: back to the committee page.
    await technical.goto(`${CORE}/admin/administration/committees/${media.id}`);
    await expect(
      technicalTeams.getByText(MEMBER_NAME, { exact: true })
    ).toBeVisible();
    await expect(
      technicalTeams.getByRole("button", { name: "Revoke" })
    ).toHaveCount(0);

    // 10. Revocation keeps the record and shows the member why.
    // The member has two requests now (rejected, then verified): filter to the verified one.
    await reviewer.goto(
      `${CORE}/admin/membership/verifications?status=verified`
    );
    await reviewer
      .getByRole("link", { name: MEMBER_NAME, exact: true })
      .click();
    await reviewer.getByRole("button", { name: "Revoke verification" }).click();
    const revoke = reviewer.getByRole("dialog");
    await revoke
      .getByLabel("Reason for the member")
      .fill("Synthetic: enrolment has ended.");
    await revoke.getByRole("button", { name: "Revoke verification" }).click();
    await expect(reviewer.getByText("Verification revoked")).toBeVisible();
    await member.reload();
    await expect(
      squ.getByText("Synthetic: enrolment has ended.")
    ).toBeVisible();
    await expect(
      member.getByRole("link", { name: "SQU Verified" })
    ).toHaveCount(0);
    const history =
      await db`SELECT action FROM private.uc02_audit WHERE changes ->> 'memberId' = ${MEMBER}
        AND (action LIKE 'verification.%' OR action LIKE 'leadership.%') ORDER BY occurred_at, id`;
    expect(history.map((row) => row.action)).toEqual([
      "verification.submitted",
      "leadership.requested",
      "verification.document_viewed",
      "verification.rejected",
      "verification.document_viewed",
      "verification.submitted",
      "verification.document_viewed",
      "verification.approved",
      "leadership.approved",
      "verification.revoked",
    ]);

    // 11. Arabic, right to left, and a phone width without horizontal scrolling.
    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    contexts.push(phoneContext);
    const phone = await phoneContext.newPage();
    await websiteLogin(phone, "event-member@example.test");
    await phone
      .context()
      .addCookies([{ name: "es-locale", value: "ar", url: WEB }]);
    await phone.goto(`${WEB}/profile`);
    await expect(phone.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      phone.getByRole("heading", {
        name: "توثيق صفة طالب جامعة السلطان قابوس",
      })
    ).toBeVisible();
    await expect(
      phone.getByRole("heading", { name: "قيادة اللجان" })
    ).toBeVisible();
    await expect(phone.getByText(TEAM_AR).first()).toBeVisible();
    expect(await noHorizontalScroll(phone)).toBe(true);
    await phone.goto(`${WEB}/register`);
    await expect(
      phone.getByRole("radio", { name: "مهني في القطاع الصناعي" })
    ).toBeVisible();
    expect(await noHorizontalScroll(phone)).toBe(true);
  } finally {
    await db`GRANT EXECUTE ON FUNCTION private.get_own_leadership(uuid) TO app_runtime`.catch(
      () => undefined
    );
    for (const context of contexts) await context.close();
    await db.end();
  }
});
