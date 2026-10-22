import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  manager: vi.fn(),
  canReview: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/auth/manager", () => ({ getManagerContext: state.manager }));
vi.mock("@/lib/membership/server", () => ({
  canReviewMembership: state.canReview,
  readMembershipDocument: state.read,
}));

const { GET } =
  await import("@/app/admin/(protected)/membership/[id]/document/route");

const ID = "33333333-3333-4333-8333-333333333333";
const get = (id = ID) =>
  GET(new Request(`https://admin.essqu.com/admin/membership/${id}/document`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  state.manager.mockReset().mockResolvedValue({
    kind: "manager",
    userId: "11111111-1111-4111-8111-111111111111",
  });
  state.canReview.mockReset().mockResolvedValue(true);
  state.read.mockReset().mockResolvedValue({
    mediaType: "image/png",
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
});

describe("GET /admin/membership/[id]/document", () => {
  it("serves the card to a reviewer, uncached and unsniffable", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'"
    );
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="squ-id-card.png"'
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it("is 401 signed out, 403 for a non-reviewer and 404 when there is nothing to show", async () => {
    state.manager.mockResolvedValueOnce({ kind: "anonymous" });
    expect((await get()).status).toBe(401);
    state.canReview.mockResolvedValueOnce(false);
    expect((await get()).status).toBe(403);
    state.read.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
    expect(state.read).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the database is unavailable", async () => {
    state.canReview.mockRejectedValueOnce(new Error("down"));
    expect((await get()).status).toBe(503);
  });
});
