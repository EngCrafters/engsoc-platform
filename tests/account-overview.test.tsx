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

const noop = async () => {};

/** Visible text only: drops React's injected form-replay script and markup. */
function visibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const committees = [{ id: "events-id", name: "Events" }];

function profile(
  overrides: Partial<Parameters<typeof AccountProfileSection>[0]> = {}
) {
  return renderToStaticMarkup(
    <AccountProfileSection
      email="manager@example.test"
      userId="11111111-1111-4111-8111-111111111111"
      committees={committees}
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

  it("lists exactly the assigned committee scope", () => {
    const html = profile();
    expect(html).toContain("Events");
    expect(html).not.toContain("Media");
    expect(html.match(/>Active</g)).toHaveLength(1);
  });

  it("never labels the user an owner", () => {
    expect(visibleText(profile())).not.toMatch(/>Owner</);
    expect(profile()).toMatch(
      /Application access level, checked on every request/
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
  const html = renderToStaticMarkup(<AccountPermissionsSection />);

  it("explains that this is not a platform-wide owner role", () => {
    expect(html).toMatch(/one fixed committee scope/);
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
    expect(html).toMatch(/never changes which\s+committees/);
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
          accessLevel="COMMITTEE_MANAGER"
          email="manager@example.test"
          committees={committees}
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
            accessLevel={accessLevel}
            email="global@example.test"
            committees={committees}
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

  it("separates Technical Administration and access management", () => {
    const html = sidebar("TECHNICAL");
    expect(html).toContain("Technical Administration");
    expect(html).toContain('href="/admin/access"');
  });

  it("keeps the Administration section from Committee Managers", () => {
    const html = sidebar("COMMITTEE_MANAGER");
    expect(html).not.toContain('href="/admin/administration"');
    expect(html).not.toContain('href="/admin/access"');
  });
});

describe("membership navigation", () => {
  function sidebar(membership: { awaiting: number } | null) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <AdminSidebar
            accessLevel="COMMITTEE_MANAGER"
            email="society-affairs@example.test"
            committees={[{ id: "sa-id", name: "Society Affairs Committee" }]}
            membership={membership}
            logoutAction={noop}
            onOpenSettings={() => {}}
          />
        </SidebarProvider>
      </TooltipProvider>
    );
  }

  it("shows the section to a committee manager the database confirms as a reviewer", () => {
    const html = sidebar({ awaiting: 4 });
    expect(html).toContain('aria-label="Membership"');
    expect(html).toContain('href="/admin/membership"');
    expect(html).toContain("4 awaiting a decision");
  });

  it("hides it whenever the database has not confirmed reviewer access", () => {
    const html = sidebar(null);
    expect(html).not.toContain('href="/admin/membership"');
    expect(html).toContain('href="/admin/events"');
  });
});
