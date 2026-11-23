import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: { execute: vi.fn() } }));

import { resolveManagerContext } from "../lib/auth/manager";
import { parseAccess } from "../lib/auth/permissions";

// The dashboard context comes from Supabase Auth (identity) and one routine
// (private.get_dashboard_access, migration 0035) for the permissions; neither
// metadata nor a cached claim decides anything.
function clientFor(userId: string | null = "manager-id") {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: userId ? { id: userId, email: "manager@example.test" } : null,
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

const committees = [
  { id: "media-id", name: "Media Committee", slug: "media", archived: false },
  { id: "forum-id", name: "Forum Committee", slug: "forum", archived: false },
];
const answer =
  (permissions: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  async () =>
    parseAccess({
      code: "SUCCESS",
      level: null,
      levelCommitteeId: null,
      permissions,
      appointments: [],
      committees,
      ...extra,
    });

describe("manager authorization context", () => {
  it("scopes a Committee Manager's events to their committee", async () => {
    const context = await resolveManagerContext(
      clientFor(),
      answer(
        { "events.view": ["media-id"], "events.create": ["media-id"] },
        { level: "COMMITTEE_MANAGER", levelCommitteeId: "media-id" }
      )
    );
    expect(context).toMatchObject({
      kind: "manager",
      userId: "manager-id",
      accessLevel: "COMMITTEE_MANAGER",
      committees: [{ id: "media-id", name: "Media Committee", slug: "media" }],
    });
    expect(context.kind === "manager" && context.allCommittees).toHaveLength(2);
  });

  it("gives society-wide holders every committee", async () => {
    const context = await resolveManagerContext(
      clientFor(),
      answer({ "events.view": "all" }, { level: "BOARD_ADMIN" })
    );
    expect(context.kind === "manager" && context.committees).toHaveLength(2);
  });

  it("lets a leader in through their group's permissions alone", async () => {
    const context = await resolveManagerContext(
      clientFor(),
      answer({ "email.send": "all" })
    );
    expect(context).toMatchObject({
      kind: "manager",
      accessLevel: null,
      committees: [],
    });
  });

  it("denies an authenticated user without any permission", async () => {
    await expect(
      resolveManagerContext(clientFor(), answer({}))
    ).resolves.toEqual({
      kind: "unassigned",
      userId: "manager-id",
      email: "manager@example.test",
    });
  });

  it("ignores permission names it does not know", async () => {
    const context = await resolveManagerContext(
      clientFor(),
      answer({ "everything.allowed": "all", "events.view": "all" })
    );
    expect(
      context.kind === "manager" && Object.keys(context.access.permissions)
    ).toEqual(["events.view"]);
  });

  it("fails closed when the database cannot answer", async () => {
    await expect(
      resolveManagerContext(clientFor(), async () => null)
    ).rejects.toThrow("Unable to verify dashboard authorization.");
    await expect(
      resolveManagerContext(clientFor(), async () => {
        throw new Error("connection refused");
      })
    ).rejects.toThrow("Unable to verify dashboard authorization.");
  });

  it("denies a request with no Auth user", async () => {
    await expect(
      resolveManagerContext(clientFor(null), answer({ "events.view": "all" }))
    ).resolves.toEqual({ kind: "anonymous" });
  });
});
