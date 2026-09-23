import { describe, expect, it } from "vitest";
import {
  decodeRegistrationCursor,
  encodeRegistrationCursor,
} from "@/lib/admin-registrations/cursor";
import { buildRegistrationCsv } from "@/lib/admin-registrations/csv";

const eventId = "11111111-1111-4111-8111-111111111111";
const cursor = {
  id: "22222222-2222-4222-8222-222222222222",
  registeredAt: "2026-09-23T12:00:00.000Z",
};

describe("admin registration cursor", () => {
  it("round trips only within its event and status scope", () => {
    const encoded = encodeRegistrationCursor(cursor, eventId, "waitlisted");
    expect(decodeRegistrationCursor(encoded, eventId, "waitlisted")).toEqual({
      cursor,
      invalid: false,
    });
    expect(
      decodeRegistrationCursor(encoded, eventId, "confirmed").invalid
    ).toBe(true);
    expect(
      decodeRegistrationCursor(
        encoded,
        "33333333-3333-4333-8333-333333333333",
        "waitlisted"
      ).invalid
    ).toBe(true);
  });

  it("rejects malformed and oversized cursors", () => {
    expect(
      decodeRegistrationCursor("not-base64", eventId, "confirmed").invalid
    ).toBe(true);
    expect(
      decodeRegistrationCursor("x".repeat(1025), eventId, "confirmed").invalid
    ).toBe(true);
  });

  it("escapes CSV cells and neutralizes formula prefixes", () => {
    const csv = buildRegistrationCsv([
      {
        id: eventId,
        attendeeName: "=SUM(A1)",
        attendeeEmail: 'a"b@example.test',
        status: "confirmed",
        registeredAt: "2026-09-23T12:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"\'=SUM(A1)"');
    expect(csv).toContain('"a""b@example.test"');
    expect(csv).toContain("\r\n");
  });
});
