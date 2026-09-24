import { describe, expect, it } from "vitest";
import { adminErrorMessage } from "@/lib/admin-errors";

describe("manager error contract", () => {
  it("explains published-event edit restrictions", () => {
    const message = adminErrorMessage("INVALID_TRANSITION");
    expect(message).toMatch(/registrations.*move date/i);
    expect(message).toMatch(/past events.*date or capacity/i);
  });

  it("explains capacity changes without exposing database details", () => {
    const message = adminErrorMessage("CAPACITY_BELOW_COUNT");
    expect(message).toMatch(/confirmed registrations/i);
    expect(message).not.toMatch(/postgres|sqlstate|private\./i);
  });

  it("uses one safe fallback for unknown failures", () => {
    expect(adminErrorMessage("UNKNOWN_CODE")).toMatch(
      /unexpected server error/i
    );
  });

  it("maps expected maintenance and system codes without leaking internals", () => {
    for (const code of [
      "ACTOR_NOT_FOUND",
      "USER_NOT_FOUND",
      "COMMITTEE_NOT_FOUND",
      "ALREADY_ACTIVE",
      "ALREADY_REVOKED",
      "DENIED",
      "DATABASE_UNAVAILABLE",
      "TIMEOUT",
      "EXPORT_LIMIT",
    ]) {
      const message = adminErrorMessage(code);
      expect(message).not.toMatch(/unexpected server error/i);
      expect(message).not.toMatch(
        /sqlstate|private\.|public\.|stack trace|postgres/i
      );
    }
  });
});
