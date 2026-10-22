import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { resolveManagerContext } from "../lib/auth/manager";

function clientFor({
  userId = "manager-id",
  grants = [{ committee_id: "events-id", access_level: "COMMITTEE_MANAGER" }],
  committees = [{ id: "events-id", name: "Events" }],
}: {
  userId?: string | null;
  grants?: Array<{ committee_id: string | null; access_level: string }>;
  committees?: Array<{ id: string; name: string; slug?: string }>;
} = {}) {
  const managerQuery = {
    select: () => ({
      is: () => ({
        maybeSingle: async () => ({ data: grants[0] ?? null, error: null }),
      }),
    }),
  };
  const committeeQuery = {
    select: () => ({
      in: () => ({ order: async () => ({ data: committees, error: null }) }),
      not: () => ({ order: async () => ({ data: committees, error: null }) }),
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
      table === "administrative_access" ? managerQuery : committeeQuery,
  } as unknown as SupabaseClient;
}

describe("manager authorization context", () => {
  it("returns a manager only for a live database grant", async () => {
    await expect(resolveManagerContext(clientFor())).resolves.toEqual({
      kind: "manager",
      userId: "manager-id",
      email: "manager@example.test",
      accessLevel: "COMMITTEE_MANAGER",
      committees: [{ id: "events-id", name: "Events" }],
    });
  });

  it("carries each committee's stable slug for membership review", async () => {
    const context = await resolveManagerContext(
      clientFor({
        grants: [{ committee_id: "sa-id", access_level: "COMMITTEE_MANAGER" }],
        committees: [
          {
            id: "sa-id",
            name: "Society Affairs Committee",
            slug: "society-affairs",
          },
        ],
      })
    );
    expect(context.kind === "manager" && context.committees).toEqual([
      {
        id: "sa-id",
        name: "Society Affairs Committee",
        slug: "society-affairs",
      },
    ]);
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

  it("resolves Board Administration with global committee scope", async () => {
    await expect(
      resolveManagerContext(
        clientFor({
          grants: [{ access_level: "BOARD_ADMIN", committee_id: null }],
          committees: [
            { id: "media-id", name: "Media Committee" },
            { id: "forum-id", name: "Forum Committee" },
          ],
        })
      )
    ).resolves.toEqual({
      kind: "manager",
      userId: "manager-id",
      email: "manager@example.test",
      accessLevel: "BOARD_ADMIN",
      committees: [
        { id: "media-id", name: "Media Committee" },
        { id: "forum-id", name: "Forum Committee" },
      ],
    });
  });

  it("does not retain a committee that was revoked between scoped reads", async () => {
    await expect(
      resolveManagerContext(
        clientFor({
          grants: [
            { committee_id: "events-id", access_level: "COMMITTEE_MANAGER" },
          ],
          committees: [],
        })
      )
    ).resolves.toEqual({
      kind: "unassigned",
      userId: "manager-id",
      email: "manager@example.test",
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
