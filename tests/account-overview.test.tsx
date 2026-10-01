import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/account" }));

import { AccountOverview } from "../components/admin/account-overview";
import { NoAccessState } from "../components/admin/no-access-state";
import { AdminSidebar } from "../components/admin/admin-sidebar";
import { AdminMobileNav } from "../components/admin/admin-mobile-nav";
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

function account(
  overrides: Partial<Parameters<typeof AccountOverview>[0]> = {}
) {
  return renderToStaticMarkup(
    <AccountOverview
      email="manager@example.test"
      userId="11111111-1111-4111-8111-111111111111"
      committees={committees}
      logoutAction={noop}
      {...overrides}
    />
  );
}

describe("admin account page", () => {
  it("shows the manager identity and role", () => {
    const html = account();
    expect(html).toContain("manager@example.test");
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
    expect(html).toContain("Committee manager");
  });

  it("uses separate accessible heading IDs in the settings dialog", () => {
    const html = account({ compact: true, idPrefix: "settings-account" });
    expect(html).toContain('aria-labelledby="settings-account-identity-title"');
    expect(html).toContain('id="settings-account-identity-title"');
    expect(html).not.toContain('id="account-identity-title"');
  });

  it("lists every active committee scope, each marked active", () => {
    const html = account();
    expect(html).toContain("Events");
    expect(html).toContain("Media");
    expect(html.match(/>Active</g)).toHaveLength(2);
  });

  it("explains that this is not a platform-wide owner role", () => {
    const html = account();
    expect(html).toMatch(/not a platform-wide\s+owner or super-admin role/);
    expect(html).toMatch(/work outside this\s+application/);
    expect(html).not.toMatch(/Supabase/);
    expect(html).not.toMatch(/>Owner</);
  });

  it("links to recovery and offers sign-out", () => {
    const html = account();
    expect(html).toContain('href="/admin/recovery"');
    expect(html).toContain("Sign out");
    expect(html).toMatch(/never changes which\s+committees/);
  });

  it("offers no grant, revoke or other maintenance controls", () => {
    const html = account();
    // The only interactive controls are the recovery link and sign-out.
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html.match(/href="/g)).toHaveLength(1);
    expect(html).not.toMatch(/(grant|revoke) access<\/(button|a)>/i);
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

describe("admin shell identity and scope", () => {
  const props = {
    email: "manager@example.test",
    committees,
    logoutAction: noop,
    onOpenSettings: () => {},
  };

  it("shows identity, role, every committee and a settings dialog trigger (sidebar)", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AdminSidebar {...props} />
      </TooltipProvider>
    );
    expect(html).toContain("manager@example.test");
    expect(html).toContain("Committee manager");
    expect(html).toContain("Events");
    expect(html).toContain("Media");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Settings");
    expect(html).not.toContain('href="/admin/account"');
    expect(visibleText(html)).not.toMatch(/owner|super-?admin/i);
  });

  it("never labels the user an owner (mobile header)", () => {
    const html = renderToStaticMarkup(<AdminMobileNav {...props} />);
    expect(visibleText(html)).not.toMatch(/owner|super-?admin/i);
    expect(html).toContain('aria-label="Open settings"');
  });
});
