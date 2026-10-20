import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: { execute: state.execute } }));

import { getMembershipAccess } from "../lib/membership/server";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const counts = {
  pending_review: 3,
  verified: 1,
  approved: 0,
  rejected: 0,
  activationPending: 0,
};

/** The shape Drizzle throws: its message carries the query and parameters. */
function queryError(cause: unknown) {
  return Object.assign(
    new Error(
      `Failed query: SELECT private.get_membership_review_overview($1::uuid) AS result\nparams: ${ACTOR}`
    ),
    { cause }
  );
}

describe("getMembershipAccess", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    state.execute.mockReset();
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it("recognises a reviewer from the database's answer", async () => {
    state.execute.mockResolvedValue([
      {
        result: {
          code: "SUCCESS",
          reviewer: "society_affairs",
          policy: null,
          counts,
        },
      },
    ]);
    await expect(getMembershipAccess(ACTOR)).resolves.toEqual({
      kind: "reviewer",
      overview: { reviewer: "society_affairs", policy: null, counts },
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("treats a refused actor, such as another committee's manager, as no access", async () => {
    state.execute.mockResolvedValue([{ result: { code: "FORBIDDEN" } }]);
    await expect(getMembershipAccess(ACTOR)).resolves.toEqual({
      kind: "none",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("reports a database without migration 0025 as unavailable, never as access, and says why", async () => {
    for (const code of ["42883", "42P01", "3F000"]) {
      log.mockClear();
      state.execute.mockRejectedValue(
        queryError(Object.assign(new Error("does not exist"), { code }))
      );
      await expect(getMembershipAccess(ACTOR)).resolves.toEqual({
        kind: "unavailable",
        reason: "setup-required",
      });
      expect(log).toHaveBeenCalledWith("membership_review_unavailable", {
        reason: "MIGRATION_0025_NOT_APPLIED",
        code,
      });
    }
  });

  it("reports other failures without the query, parameters or actor", async () => {
    state.execute.mockRejectedValue(
      queryError(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        })
      )
    );
    await expect(getMembershipAccess(ACTOR)).resolves.toEqual({
      kind: "unavailable",
      reason: "database-error",
    });
    expect(log).toHaveBeenCalledWith("membership_review_unavailable", {
      reason: "DATABASE_ERROR",
      code: null,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(ACTOR);
  });
});
