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

const committees = [
  { id: "events-id", name: "Events" },
  { id: "media-id", name: "Media" },
];

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
    expect(html).toContain("Committee manager");
  });

  it("uses separate accessible heading IDs in the settings dialog", () => {
    const html = profile({ idPrefix: "settings-account" });
    expect(html).toContain('aria-labelledby="settings-account-identity-title"');
    expect(html).toContain('id="settings-account-identity-title"');
    expect(html).not.toContain('id="account-identity-title"');
  });

  it("lists every active committee scope, each marked active", () => {
    const html = profile();
    expect(html).toContain("Events");
    expect(html).toContain("Media");
    expect(html.match(/>Active</g)).toHaveLength(2);
  });

  it("never labels the user an owner", () => {
    expect(visibleText(profile())).not.toMatch(/>Owner</);
    expect(profile()).toMatch(/Not a platform-wide owner or super-admin role/);
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
    expect(html).toMatch(/not a platform-wide\s+owner or super-admin role/);
    expect(html).toMatch(/work\s+outside this application/);
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
    expect(html).toContain("No committee access assigned");
    expect(html).toContain("pending@example.test");
    expect(html).toMatch(/Signing in worked/);
    expect(html).toMatch(/not a sign-in problem/);
  });

  it("states that a password reset will not restore access", () => {
    expect(html).toMatch(/Resetting your password will not restore access/);
    expect(html).not.toContain("/admin/recovery");
  });

  it("names the maintenance authority as the way forward", () => {
    expect(html).toMatch(/platform maintenance\s+authority/);
    expect(html).toContain("Sign out");
    expect(html).not.toMatch(/Supabase/);
  });
});

describe("admin sidebar identity and scope", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
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
    expect(html).toContain("Committee manager");
    expect(html).toContain("Scope: Events +1");
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
