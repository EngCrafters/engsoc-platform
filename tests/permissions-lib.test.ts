import { describe, expect, it } from "vitest";
import {
  accountAccessView,
  can,
  canAny,
  committeesFor,
  hasFullAccess,
  PERMISSION_KEYS,
  toDashboardAccess,
} from "../lib/auth/permissions";
import { dashboardNav } from "../components/admin/admin-navigation";
import { managerContext } from "./support/manager-fixture";

const committees = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];
const who = (permissions: Record<string, unknown>) => ({
  access: toDashboardAccess({
    code: "SUCCESS",
    permissions,
    appointments: [],
  })!,
});

describe("permission checks (ADR 0027)", () => {
  it("treats society-wide as covering every committee and scoped grants as covering theirs", () => {
    const leader = who({ "events.view": ["a"], "email.send": "all" });
    expect(can(leader, "events.view", "a")).toBe(true);
    expect(can(leader, "events.view", "b")).toBe(false);
    expect(can(leader, "events.view")).toBe(false);
    expect(canAny(leader, "events.view")).toBe(true);
    expect(can(leader, "email.send")).toBe(true);
    expect(can(leader, "email.send", "b")).toBe(true);
    expect(canAny(leader, "permissions.manage")).toBe(false);
    expect(committeesFor(leader, "events.view", committees)).toEqual([
      committees[0],
    ]);
    expect(committeesFor(leader, "email.send", committees)).toEqual(committees);
  });

  it("ignores unknown keys and malformed scopes from the database answer", () => {
    const parsed = toDashboardAccess({
      code: "SUCCESS",
      permissions: {
        "events.view": "everything",
        "events.edit": [1],
        "magic.key": "all",
        "email.send": "all",
      },
    })!;
    expect(Object.keys(parsed.permissions)).toEqual(["email.send"]);
    expect(toDashboardAccess({ code: "FORBIDDEN" })).toBeNull();
  });

  it("recognises full access only when every permission is society-wide", () => {
    expect(
      hasFullAccess(
        who(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "all"])))
      )
    ).toBe(true);
    expect(
      hasFullAccess(
        who({
          ...Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "all"])),
          "events.view": ["a"],
        })
      )
    ).toBe(false);
  });

  it("builds navigation and the account view from permissions only", () => {
    const board = managerContext("BOARD_ADMIN", { committees });
    const nav = dashboardNav(board);
    expect(nav.items["/admin/administration/permissions"]).toBe(true);
    expect(nav.items["/admin/communications/email"]).toBe(true);
    expect(nav.scopeLabel).toBe("All Committees");
    const manager = managerContext("COMMITTEE_MANAGER", {
      committees: [committees[0]],
    });
    const managerNav = dashboardNav(manager);
    expect(managerNav.items["/admin/administration"]).toBe(false);
    expect(managerNav.items["/admin/events"]).toBe(true);
    expect(managerNav.scopeLabel).toBe("Alpha");
    const view = accountAccessView(manager);
    expect(view.level).toBe("Committee Manager");
    expect(view.permissions.find((p) => p.key === "events.view")?.scope).toBe(
      "Alpha"
    );
  });
});
