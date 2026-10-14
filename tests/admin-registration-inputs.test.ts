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
        attendeePhone: "+15550100099",
        status: "confirmed",
        registeredAt: "2026-09-23T12:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"\'=SUM(A1)"');
    expect(csv).toContain('"a""b@example.test"');
    // An international number starts with "+", which is a spreadsheet formula
    // prefix, so the phone goes through exactly the same neutralization as any
    // other cell. It is deliberately NOT special-cased: exempting it would be a
    // hole in the defence, and the apostrophe is what makes the cell text.
    expect(csv).toContain('"\'+15550100099"');
    expect(csv).toContain("\r\n");
  });

  it("includes a phone column and exports a not-captured phone as an empty cell", () => {
    const csv = buildRegistrationCsv([
      {
        id: eventId,
        attendeeName: "Legacy Attendee",
        attendeeEmail: "legacy@example.test",
        attendeePhone: null,
        status: "confirmed",
        registeredAt: "2026-09-23T12:00:00.000Z",
      },
    ]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "Attendee name,Attendee email,Attendee phone,Registration status,Registered at"
    );
    // A registration captured before the field existed exports as an empty cell.
    // Never a placeholder word, and never a fabricated number.
    expect(row).toBe(
      '"Legacy Attendee","legacy@example.test","","confirmed","2026-09-23T12:00:00.000Z"'
    );
  });
});
