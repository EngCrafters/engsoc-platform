import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: state.execute } }));
const { authenticate, hashToken, parseToken } = await import("@/lib/api/auth");

const request = (token: string) =>
  new Request("https://api.example/v1/events", {
    headers: { authorization: `Bearer ${token}` },
  });
beforeEach(() => {
  state.execute.mockReset();
});

describe("API token delimiter ambiguity", () => {
  it.each([
    ["abcdefgh", "abcdefghi_" + "a".repeat(33)],
    ["abcdefgh_part", "another_" + "b".repeat(35)],
    ["abcd_efgh_part", "_".repeat(43)],
  ])(
    "authenticates a stored prefix with underscores in either segment",
    async (prefix, secret) => {
      const token = `essq_test_${prefix}_${secret}`;
      const parsed = parseToken(token);
      expect(parsed?.prefixes).toContain(prefix);
      expect(parsed!.prefixes.length).toBeLessThanOrEqual(33);
      state.execute.mockImplementation(async (query) => {
        const { params } = new PgDialect().sqlToQuery(query);
        expect(params).toEqual([
          ...parsed!.prefixes,
          hashToken(token),
          "events:read",
          "staging",
        ]);
        return params.slice(0, parsed!.prefixes.length).includes(prefix) &&
          params[parsed!.prefixes.length] === hashToken(token)
          ? [
              {
                client_id: "client-1",
                client_name: "Synthetic client",
                has_scope: true,
              },
            ]
          : [];
      });
      expect(await authenticate(request(token))).toEqual({
        ok: true,
        client: { id: "client-1", name: "Synthetic client" },
      });
      expect(state.execute).toHaveBeenCalledTimes(1);
    }
  );

  it("preserves a valid client's scope denial", async () => {
    state.execute.mockResolvedValue([
      {
        client_id: "client-1",
        client_name: "Synthetic client",
        has_scope: false,
      },
    ]);
    expect(
      await authenticate(request("essq_test_abcdefgh_" + "a".repeat(43)))
    ).toEqual({ ok: false, reason: "forbidden" });
  });
  it("fails closed for unknown or multiply registered token candidates", async () => {
    const token = "essq_test_abcdefgh_" + "a".repeat(43);
    for (const rows of [[], [{ has_scope: true }, { has_scope: true }]]) {
      state.execute.mockResolvedValue(rows);
      expect(await authenticate(request(token))).toEqual({
        ok: false,
        reason: "unauthorized",
      });
    }
  });
  it("does not query for malformed credentials", async () => {
    expect(await authenticate(request("not-a-token"))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(state.execute).not.toHaveBeenCalled();
  });
});
