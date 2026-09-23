import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { resolveManagerContext } from "../lib/auth/manager";

function clientFor({
  userId = "manager-id",
  grants = [{ committee_id: "events-id" }],
  committees = [{ id: "events-id", name: "Events" }],
}: {
  userId?: string | null;
  grants?: Array<{ committee_id: string }>;
  committees?: Array<{ id: string; name: string }>;
} = {}) {
  const managerQuery = {
    select: () => ({
      is: async () => ({ data: grants, error: null }),
    }),
  };
  const committeeQuery = {
    select: () => ({
      in: () => ({
        order: async () => ({ data: committees, error: null }),
      }),
    }),
  };
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: userId ? { id: userId, email: "manager@example.test" } : null,
        },
        error: null,
      }),
    },
    from: (table: string) =>
      table === "committee_managers" ? managerQuery : committeeQuery,
  } as unknown as SupabaseClient;
}

describe("manager authorization context", () => {
  it("returns a manager only for a live database grant", async () => {
    await expect(resolveManagerContext(clientFor())).resolves.toEqual({
      kind: "manager",
      userId: "manager-id",
      email: "manager@example.test",
      committees: [{ id: "events-id", name: "Events" }],
    });
  });

  it("denies an authenticated user without an active grant", async () => {
    await expect(
      resolveManagerContext(clientFor({ grants: [] }))
    ).resolves.toEqual({
      kind: "unassigned",
      userId: "manager-id",
      email: "manager@example.test",
    });
  });

  it("does not retain a committee that was revoked between scoped reads", async () => {
    await expect(
      resolveManagerContext(
        clientFor({
          grants: [{ committee_id: "events-id" }, { committee_id: "media-id" }],
          committees: [{ id: "events-id", name: "Events" }],
        })
      )
    ).resolves.toEqual({
      kind: "manager",
      userId: "manager-id",
      email: "manager@example.test",
      committees: [{ id: "events-id", name: "Events" }],
    });
  });

  it("denies a request with no Auth user", async () => {
    await expect(
      resolveManagerContext(clientFor({ userId: null }))
    ).resolves.toEqual({
      kind: "anonymous",
    });
  });
});
