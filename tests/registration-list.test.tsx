import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RegistrationList } from "@/components/admin/registration-list";
import type { AdminRegistration } from "@/lib/admin-registrations/types";

/**
 * The administration registration table.
 *
 * The browser suite cannot reach this table: the e2e environment runs with a
 * placeholder Supabase URL, so there is no Auth server to sign a manager in
 * against, and this change must not invent a production identity to work
 * around that. The table is therefore rendered directly here, which is what
 * proves the two things that matter about the change: a captured number is
 * shown, and a registration captured before the field existed says so instead
 * of showing an empty cell or an invented value.
 */

function row(overrides: Partial<AdminRegistration> = {}): AdminRegistration {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    attendeeName: "Attendee",
    attendeeEmail: "attendee@example.test",
    attendeePhone: "+15550100001",
    status: "confirmed",
    registeredAt: "2026-10-14T09:00:00.000Z",
    ...overrides,
  };
}

function render(
  rows: AdminRegistration[],
  status: "confirmed" | "waitlisted" = "confirmed"
) {
  return renderToStaticMarkup(
    <RegistrationList
      status={status}
      registrations={rows}
      renderPromote={(registrationId) => (
        <button type="button">{registrationId}</button>
      )}
    />
  );
}

describe("admin registration list phone column", () => {
  it("shows the captured phone number", () => {
    const html = render([row()]);
    expect(html).toContain("Phone");
    expect(html).toContain("+15550100001");
  });

  it("says a legacy registration has no phone rather than leaving a blank", () => {
    const html = render([row({ attendeePhone: null })]);
    // The wide-layout cell says exactly this. An empty cell would read as a
    // rendering bug; a dash as missing data.
    expect(html).toContain(">Not captured<");
    // And no number is invented for it.
    expect(html).not.toMatch(/\+?[0-9]{7,}/);
  });

  it("shows the phone inline below md, where there is no room for a column", () => {
    const withPhone = render([row()]);
    const withoutPhone = render([row({ attendeePhone: null })]);
    // The narrow-layout copy is always in the DOM and hidden by CSS above md, so
    // a phone is never only in a column that small screens hide.
    expect(withPhone).toContain("+15550100001");
    expect(withoutPhone).toContain("Phone not captured");
  });

  it("renders a long international number without truncating it", () => {
    const html = render([row({ attendeePhone: "+123456789012345" })]);
    expect(html).toContain("+123456789012345");
  });

  it("still renders the empty state when there is nothing to show", () => {
    const html = render([]);
    expect(html).toContain("No registrations yet");
    expect(html).not.toContain("Phone");
  });

  it("still offers the promote action on the waitlist tab", () => {
    const html = render([row({ status: "waitlisted" })], "waitlisted");
    expect(html).toContain("Action");
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
  });
});
