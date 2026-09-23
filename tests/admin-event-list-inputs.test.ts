import { describe, expect, it } from "vitest";
import {
  decodeAdminEventCursor,
  encodeAdminEventCursor,
} from "../lib/admin-events/cursor";
import { parseAdminEventFilter } from "../lib/admin-events/types";

describe("admin event list inputs", () => {
  const cursor = {
    eventDate: "2026-12-01T09:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  };
  const scope = { committeeId: null, filter: "all" as const };

  it("round-trips a cursor and safely rejects malformed cursor input", () => {
    expect(
      decodeAdminEventCursor(encodeAdminEventCursor(cursor, scope), scope)
    ).toEqual({ cursor, invalid: false });
    expect(decodeAdminEventCursor("not-base64", scope)).toEqual({
      cursor: null,
      invalid: true,
    });
    expect(
      decodeAdminEventCursor(
        Buffer.from(
          JSON.stringify({ eventDate: "invalid", id: cursor.id })
        ).toString("base64url"),
        scope
      )
    ).toEqual({ cursor: null, invalid: true });
  });

  it("rejects a cursor from another filter", () => {
    expect(
      decodeAdminEventCursor(encodeAdminEventCursor(cursor, scope), {
        committeeId: null,
        filter: "published",
      })
    ).toEqual({ cursor: null, invalid: true });
  });

  it("falls back to the safe active-list filter for unexpected values", () => {
    expect(parseAdminEventFilter("published")).toBe("published");
    expect(parseAdminEventFilter("forged")).toBe("all");
  });
});
