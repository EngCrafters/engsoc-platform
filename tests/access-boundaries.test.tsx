import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }));
vi.mock("../lib/auth/manager", () => ({ getManagerContext: mocks.context }));
vi.mock("../lib/access/server", () => ({
  listAccess: mocks.read,
  listAuthDirectory: mocks.read,
  listAccessAudit: mocks.read,
}));
vi.mock("../app/admin/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("../app/admin/(protected)/access/user-directory", () => ({
  UserDirectory: () => null,
}));
vi.mock("../components/admin/admin-shell", () => ({
  AdminShell: () => createElement("div", null, "PRIVATE ADMIN SHELL"),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));

import ProtectedLayout from "../app/admin/(protected)/layout";
import AccessPage from "../app/admin/(protected)/access/page";
import {
  authStatus,
  accessStatus,
  scopeLabel,
  auditStateLabel,
  type UserRecord,
} from "../app/admin/(protected)/access/user-types";

describe("retained identities at the admin page boundary", () => {
  beforeEach(() => {
    mocks.context.mockReset().mockResolvedValue({
      kind: "unassigned",
      userId: "retained-user",
      email: "retained@example.test",
    });
    mocks.read.mockReset();
  });
  it("never renders protected children or navigation for a retained no-access identity", async () => {
    const html = renderToStaticMarkup(
      await ProtectedLayout({
        children: createElement("div", null, "PRIVATE ADMIN CONTENT"),
      })
    );
    expect(html).toContain("Administrative access not assigned");
    expect(html).toContain("retained@example.test");
    expect(html).not.toContain("PRIVATE ADMIN");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("denies the Technical page directly for retained identities and Board", async () => {
    for (const context of [
      { kind: "unassigned", userId: "retained-user" },
      { kind: "manager", userId: "board-user", accessLevel: "BOARD_ADMIN" },
    ]) {
      mocks.context.mockResolvedValue(context);
      expect(renderToStaticMarkup(await AccessPage())).toContain(
        "only to the Technical Team"
      );
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("keeps confirmation separate from authorization and renders audited scope changes", () => {
    const user: UserRecord = {
      userId: "retained-user",
      email: "retained@example.test",
      emailConfirmed: true,
      invited: false,
      createdAt: "2026-10-07T00:00:00Z",
      lastSignInAt: null,
      access: {
        level: "COMMITTEE_MANAGER",
        committeeId: "support",
        committeeName: "Support & Logistics",
        active: false,
      },
    };
    expect(authStatus(user)).toBe("Confirmed");
    expect(accessStatus(user)).toBe("Revoked");
    expect(scopeLabel(user)).toBe("—");
    expect(
      auditStateLabel(
        {
          accessLevel: "COMMITTEE_MANAGER",
          committeeId: "support",
          active: true,
        },
        [{ id: "support", name: "Support & Logistics" }]
      )
    ).toBe("Committee Manager · Support & Logistics");
    expect(
      auditStateLabel(
        {
          accessLevel: "COMMITTEE_MANAGER",
          committeeId: "support",
          active: false,
        },
        []
      )
    ).toBe("No access");
  });
});
