import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ manager: vi.fn(), access: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/events",
  redirect: vi.fn(),
}));
vi.mock("../lib/auth/manager", () => ({ getManagerContext: state.manager }));
vi.mock("../lib/membership/server", () => ({
  getMembershipAccess: state.access,
}));
vi.mock("../app/admin/actions", () => ({ logoutAction: async () => {} }));

const { default: ProtectedAdminLayout } =
  await import("../app/admin/(protected)/layout");
const { TooltipProvider } = await import("../components/ui/tooltip");

const societyAffairsManager = {
  kind: "manager" as const,
  userId: "11111111-1111-4111-8111-111111111111",
  email: "society-affairs@example.test",
  accessLevel: "COMMITTEE_MANAGER" as const,
  committees: [
    { id: "sa-id", name: "Society Affairs Committee", slug: "society-affairs" },
  ],
};
const mediaManager = {
  ...societyAffairsManager,
  userId: "22222222-2222-4222-8222-222222222222",
  email: "media@example.test",
  committees: [{ id: "media-id", name: "Media Committee", slug: "media" }],
};
const counts = {
  pending_review: 2,
  verified: 1,
  approved: 0,
  rejected: 0,
  activationPending: 0,
};

/** The root layout (app/layout.tsx) supplies the tooltip provider. */
async function render() {
  return renderToStaticMarkup(
    <TooltipProvider>
      {await ProtectedAdminLayout({ children: <p>page</p> })}
    </TooltipProvider>
  );
}

describe("protected admin layout: membership section", () => {
  beforeEach(() => {
    state.manager.mockReset().mockResolvedValue(societyAffairsManager);
    state.access.mockReset();
  });

  it("shows Membership to a Society Affairs manager the database confirms", async () => {
    state.access.mockResolvedValue({
      kind: "reviewer",
      overview: { reviewer: "society_affairs", policy: null, counts },
    });
    const html = await render();
    expect(state.access).toHaveBeenCalledWith(societyAffairsManager.userId);
    expect(html).toContain('href="/admin/membership"');
    expect(html).toContain("3 awaiting a decision");
  });

  it("hides it from a manager the database refuses", async () => {
    state.access.mockResolvedValue({ kind: "none" });
    const html = await render();
    expect(html).not.toContain('href="/admin/membership"');
    expect(html).toContain('href="/admin/events"');
  });

  it("marks it as needing setup for a Society Affairs manager when migration 0025 is missing", async () => {
    state.access.mockResolvedValue({
      kind: "unavailable",
      reason: "setup-required",
    });
    const html = await render();
    expect(html).toContain('href="/admin/membership"');
    expect(html).toContain("setup required");
    expect(html).not.toContain("awaiting a decision");
    expect(html).toContain("<p>page</p>");
  });

  it("never shows it to another committee's manager, even when the database cannot answer", async () => {
    state.manager.mockResolvedValue(mediaManager);
    for (const access of [
      { kind: "none" },
      { kind: "unavailable", reason: "setup-required" },
      { kind: "unavailable", reason: "database-error" },
    ]) {
      state.access.mockResolvedValue(access);
      const html = await render();
      expect(html, JSON.stringify(access)).not.toContain(
        'href="/admin/membership"'
      );
      expect(html).toContain('href="/admin/events"');
    }
  });

  it("marks it for Board and Technical when the database cannot answer", async () => {
    for (const accessLevel of ["BOARD_ADMIN", "TECHNICAL"] as const) {
      state.manager.mockResolvedValue({
        ...mediaManager,
        accessLevel,
        committees: [],
      });
      state.access.mockResolvedValue({
        kind: "unavailable",
        reason: "database-error",
      });
      const html = await render();
      expect(html, accessLevel).toContain('href="/admin/membership"');
      expect(html).toContain("temporarily unavailable");
    }
  });
});
