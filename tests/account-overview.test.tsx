import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/account" }));

import {
  AccountPermissionsSection,
  AccountProfileSection,
  AccountSecuritySection,
} from "../components/admin/account-sections";
import { NoAccessState } from "../components/admin/no-access-state";
import { AdminSidebar } from "../components/admin/admin-sidebar";
import { SidebarProvider } from "../components/ui/sidebar";
import { TooltipProvider } from "../components/ui/tooltip";
import { dashboardNav } from "../components/admin/admin-navigation";
import { accountAccessView } from "../lib/auth/permissions";
import { managerContext } from "./support/manager-fixture";

const noop = async () => {};

/** Visible text only: drops React's injected form-replay script and markup. */
function visibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const committees = [{ id: "events-id", name: "Events" }];
const manager = managerContext("COMMITTEE_MANAGER", { committees });
const view = accountAccessView(manager);
const navFor = (
  level: "BOARD_ADMIN" | "TECHNICAL" | "COMMITTEE_MANAGER",
  list: { id: string; name: string; slug?: string }[] = committees
) => dashboardNav(managerContext(level, { committees: list }));

function profile(
  overrides: Partial<Parameters<typeof AccountProfileSection>[0]> = {}
) {
  return renderToStaticMarkup(
    <AccountProfileSection
      email="manager@example.test"
      userId="11111111-1111-4111-8111-111111111111"
      view={view}
      {...overrides}
    />
  );
}

describe("admin account profile", () => {
  it("shows the manager identity and role", () => {
    const html = profile();
    expect(html).toContain("manager@example.test");
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
    expect(html).toContain("Committee Manager");
  });

  it("uses separate accessible heading IDs in the settings dialog", () => {
    const html = profile({ idPrefix: "settings-account" });
    expect(html).toContain('aria-labelledby="settings-account-identity-title"');
    expect(html).toContain('id="settings-account-identity-title"');
    expect(html).not.toContain('id="account-identity-title"');
  });

  it("lists exactly where the access comes from", () => {
    const html = profile();
    expect(html).toContain("Committee Manager");
    expect(html).toContain("Personal level");
    expect(html).not.toContain("Media");
  });

  it("never labels the user an owner", () => {
    expect(visibleText(profile())).not.toMatch(/>Owner</);
    expect(profile()).toMatch(
      /Where your dashboard access comes from, checked on every request/
    );
  });

  it("offers no interactive controls", () => {
    const html = profile();
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("href=");
  });
});

describe("admin account permissions", () => {
  const html = renderToStaticMarkup(<AccountPermissionsSection view={view} />);

  it("lists each permission with its scope, not a platform-wide owner role", () => {
    expect(html).toContain("View events");
    expect(html).toContain("Events and registrations");
    expect(html).not.toContain("Society-wide");
    expect(html).toMatch(
      /permissions assigned to the committees and teams you lead/
    );
    expect(html).toMatch(/outside this application/);
    expect(html).not.toMatch(/Supabase/);
    expect(html).not.toMatch(/>Owner</);
  });

  it("offers no grant, revoke or other maintenance controls", () => {
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/(grant|revoke) access<\/(button|a)>/i);
  });
});

describe("admin account security", () => {
  const html = renderToStaticMarkup(
    <AccountSecuritySection logoutAction={noop} />
  );

  it("links to recovery and offers sign-out", () => {
    expect(html).toContain('href="/admin/recovery"');
    expect(html).toContain("Sign out");
    expect(html).toMatch(/never changes your\s+permissions/);
  });

  it("has only the recovery link and the sign-out button", () => {
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html.match(/href="/g)).toHaveLength(1);
    expect(html).not.toContain("<input");
  });
});

describe("no-committee-access state", () => {
  const html = renderToStaticMarkup(
    <NoAccessState email="pending@example.test" logoutAction={noop} />
  );

  it("says authentication succeeded and this is not a sign-in failure", () => {
    expect(html).toContain("Administrative access not assigned");
    expect(html).toContain("pending@example.test");
    expect(html).toMatch(
      /You’re signed in, but this account does not currently have administrative access/
    );
  });

  it("states that a password reset will not restore access", () => {
    expect(html).toMatch(/Resetting your password will not restore access/);
    expect(html).not.toContain("/admin/recovery");
  });

  it("names the Technical Team as the way forward", () => {
    expect(html).toMatch(/Ask the Technical Team/);
    expect(html).toContain("Sign out");
    expect(html).not.toMatch(/Supabase/);
  });
});

describe("admin sidebar identity and scope", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
          nav={navFor("COMMITTEE_MANAGER")}
          email="manager@example.test"
          logoutAction={noop}
          onOpenSettings={() => {}}
        />
      </SidebarProvider>
    </TooltipProvider>
  );

  it("shows identity, role, committee scope and the navigation groups", () => {
    expect(html).toContain("manager@example.test");
    expect(html).toContain("Committee Manager");
    expect(html).toContain("Events");
    expect(html).toContain('href="/admin/events"');
    expect(html).toContain('href="/admin/events/new"');
    expect(html).toContain('href="/admin/account"');
  });

  it("marks the current page and exposes a settings dialog trigger", () => {
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/account"/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Settings");
  });

  it("never labels the user an owner", () => {
    expect(visibleText(html)).not.toMatch(/owner|super-?admin/i);
  });
});

describe("global administration navigation", () => {
  function sidebar(
    accessLevel: "BOARD_ADMIN" | "TECHNICAL" | "COMMITTEE_MANAGER"
  ) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <AdminSidebar
            nav={navFor(accessLevel)}
            email="global@example.test"
            logoutAction={noop}
            onOpenSettings={() => {}}
          />
        </SidebarProvider>
      </TooltipProvider>
    );
  }

  it("shows Board global scope and the Administration section (ADR 0024)", () => {
    const html = sidebar("BOARD_ADMIN");
    expect(html).toContain("Board Administration");
    expect(html).toContain("All Committees");
    expect(html).toContain('href="/admin/administration"');
    expect(html).toContain('href="/admin/access"');
  });

  it("gives Technical access management, and the permissions page to both (ADR 0027)", () => {
    const html = sidebar("TECHNICAL");
    expect(html).toContain("Technical Team");
    expect(html).toContain('href="/admin/access"');
    expect(html).toContain('href="/admin/administration/permissions"');
    expect(sidebar("BOARD_ADMIN")).toContain(
      'href="/admin/administration/permissions"'
    );
  });

  it("shows the Email Centre only to holders of its permission", () => {
    expect(sidebar("BOARD_ADMIN")).toContain(
      'href="/admin/communications/email"'
    );
    expect(sidebar("TECHNICAL")).not.toContain(
      'href="/admin/communications/email"'
    );
    expect(sidebar("COMMITTEE_MANAGER")).not.toContain(
      'href="/admin/communications/email"'
    );
  });

  it("keeps the Administration section from Committee Managers", () => {
    const html = sidebar("COMMITTEE_MANAGER");
    expect(html).not.toContain('href="/admin/administration"');
    expect(html).not.toContain('href="/admin/access"');
  });
});

describe("membership navigation", () => {
  function sidebar(
    membership: {
      awaiting: number;
      squPending: number;
      leadershipPending: number;
    } | null
  ) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <AdminSidebar
            nav={navFor("COMMITTEE_MANAGER", [
              {
                id: "sa-id",
                name: "Society Affairs Committee",
                slug: "society-affairs",
              },
            ])}
            email="society-affairs@example.test"
            membership={membership}
            logoutAction={noop}
            onOpenSettings={() => {}}
          />
        </SidebarProvider>
      </TooltipProvider>
    );
  }

  it("shows the section to a committee manager the database confirms as a reviewer", () => {
    const html = sidebar({ awaiting: 4, squPending: 2, leadershipPending: 3 });
    expect(html).toContain('aria-label="Membership"');
    expect(html).toContain('href="/admin/membership"');
    expect(html).toContain("4 awaiting a decision");
  });

  it("gives each queue, including Leadership, its own entry and count", () => {
    const html = sidebar({ awaiting: 4, squPending: 2, leadershipPending: 3 });
    expect(html).toContain('href="/admin/membership/verifications"');
    expect(html).toContain('href="/admin/membership/leadership"');
    expect(html).toContain(">Leadership<");
    expect(html).toContain("2 awaiting a decision");
    expect(html).toContain("3 awaiting a decision");
  });

  it("hides it whenever the database has not confirmed reviewer access", () => {
    const html = sidebar(null);
    expect(html).not.toContain('href="/admin/membership"');
    expect(html).toContain('href="/admin/events"');
  });
});
