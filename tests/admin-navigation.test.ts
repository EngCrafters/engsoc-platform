import { describe, expect, it } from "vitest";
import {
  adminBreadcrumbs,
  isAdminNavActive,
} from "../components/admin/admin-navigation";

const id = "3f8c2c1e-9a7b-4c3d-8e21-0a1b2c3d4e5f";

describe("admin navigation", () => {
  it("keeps Events active across the event list, detail and registrations", () => {
    expect(isAdminNavActive("/admin/events", "/admin/events")).toBe(true);
    expect(isAdminNavActive(`/admin/events/${id}`, "/admin/events")).toBe(true);
    expect(
      isAdminNavActive(`/admin/events/${id}/registrations`, "/admin/events")
    ).toBe(true);
  });

  it("does not highlight Events on the create page or the account page", () => {
    expect(isAdminNavActive("/admin/events/new", "/admin/events")).toBe(false);
    expect(isAdminNavActive("/admin/events/new", "/admin/events/new")).toBe(
      true
    );
    expect(isAdminNavActive("/admin/account", "/admin/events")).toBe(false);
    expect(isAdminNavActive("/admin/account", "/admin/account")).toBe(true);
  });

  it("builds a breadcrumb trail ending in the current page", () => {
    expect(adminBreadcrumbs("/admin/events")).toEqual([{ label: "Events" }]);
    expect(adminBreadcrumbs("/admin/events/new")).toEqual([
      { label: "Events", href: "/admin/events" },
      { label: "New event" },
    ]);
    expect(adminBreadcrumbs(`/admin/events/${id}/registrations`)).toEqual([
      { label: "Events", href: "/admin/events" },
      { label: "Event", href: `/admin/events/${id}` },
      { label: "Registrations" },
    ]);
    expect(adminBreadcrumbs("/admin/account")).toEqual([{ label: "Account" }]);
  });

  it("highlights and trails the membership review section", () => {
    expect(isAdminNavActive("/admin/membership", "/admin/membership")).toBe(
      true
    );
    expect(
      isAdminNavActive(`/admin/membership/${id}`, "/admin/membership")
    ).toBe(true);
    expect(isAdminNavActive(`/admin/membership/${id}`, "/admin/events")).toBe(
      false
    );
    expect(
      isAdminNavActive(`/admin/membership/${id}/document`, "/admin/membership")
    ).toBe(false);
    expect(adminBreadcrumbs("/admin/membership")).toEqual([
      { label: "Membership applications" },
    ]);
    expect(adminBreadcrumbs(`/admin/membership/${id}`)).toEqual([
      { label: "Membership applications", href: "/admin/membership" },
      { label: "Application" },
    ]);
  });

  it("gives the SQU and leadership queues their own entries and trails (ADRs 0025, 0026)", () => {
    for (const [path, entry] of [
      ["/admin/membership/verifications", "/admin/membership/verifications"],
      [
        `/admin/membership/verifications/${id}`,
        "/admin/membership/verifications",
      ],
      ["/admin/membership/leadership", "/admin/membership/leadership"],
      [`/admin/membership/leadership/${id}`, "/admin/membership/leadership"],
    ]) {
      expect(isAdminNavActive(path, entry), path).toBe(true);
      // Only the queue's own entry is highlighted, not Applications.
      expect(isAdminNavActive(path, "/admin/membership"), path).toBe(false);
    }
    expect(
      isAdminNavActive(
        `/admin/membership/verifications/${id}/document`,
        "/admin/membership/verifications"
      )
    ).toBe(false);
    expect(adminBreadcrumbs("/admin/membership/leadership")).toEqual([
      { label: "Membership", href: "/admin/membership" },
      { label: "Leadership" },
    ]);
    expect(adminBreadcrumbs(`/admin/membership/verifications/${id}`)).toEqual([
      { label: "Membership", href: "/admin/membership" },
      { label: "SQU verification", href: "/admin/membership/verifications" },
      { label: "Request" },
    ]);
  });
});
