import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth/manager", () => ({
  getManagerContext: async () => ({ kind: "manager", userId: "manager" }),
}));
vi.mock("@/lib/admin-events/server", () => ({
  getAdminEvent: async () => ({
    title: "Export event",
    committeeName: "Finance",
  }),
}));
vi.mock("@/lib/admin-registrations/server", () => ({
  countAdminRegistrations: async () => ({
    confirmed_count: 0,
    waitlisted_count: 0,
  }),
  listAdminRegistrations: async () => ({ registrations: [], nextCursor: null }),
}));
vi.mock(
  "../app/admin/(protected)/events/[id]/registrations/promote-button",
  () => ({
    PromoteButton: () => null,
  })
);

import RegistrationsPage, {
  metadata,
} from "../app/admin/(protected)/events/[id]/registrations/page";

it("keeps native export POSTs identifiable without sending a cross-site Referer", async () => {
  expect(metadata.referrer).toBe("same-origin");
  const id = "11111111-1111-4111-8111-111111111111";
  const html = renderToStaticMarkup(
    await RegistrationsPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({ status: "waitlisted" }),
    })
  );
  expect(html).toContain(
    `action="/admin/events/${id}/registrations/export?status=waitlisted"`
  );
  expect(html).toContain('method="post"');
  expect(html).toContain("Export waitlisted");
});
