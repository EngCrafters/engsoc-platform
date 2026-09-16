import { describe, expect, it } from "vitest";
import { safeAdminReturnPath } from "../lib/auth/paths";

describe("safeAdminReturnPath", () => {
  it("keeps approved internal admin destinations", () => {
    expect(safeAdminReturnPath("/admin/events?committee=events")).toBe(
      "/admin/events?committee=events"
    );
  });

  it.each([
    "https://attacker.example/admin/events",
    "//attacker.example/admin/events",
    "/events",
    "/admin\\events",
    "not a url",
  ])("rejects unsafe destination %s", (value) => {
    expect(safeAdminReturnPath(value)).toBe("/admin/events");
  });
});
