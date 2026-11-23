import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  createGate,
  oneQueryPerConnection,
} from "../db/one-query-per-connection";

/**
 * Regression for the Core hang of 2026-11-22: postgres.js pipelined concurrent queries on its one
 * connection, Supabase's transaction pooler lost a pipelined reply, and every later query waited
 * forever (registration, health and every API route that reads the database). The runtime client
 * must never have more queries in flight than connections.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** A stand-in for a postgres.js client that records how many queries run at once. */
function fakeClient() {
  const stats = { inFlight: 0, maxInFlight: 0, started: [] as string[] };
  const execute = async (query: string, values: boolean, fail: boolean) => {
    stats.started.push(query);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await tick();
    stats.inFlight--;
    if (fail) throw new Error(`failed: ${query}`);
    return values ? [[query]] : [{ query }];
  };
  const unsafe = (query: string) => {
    let values = false;
    const pending = {
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) => execute(query, values, query.includes("FAIL")).then(resolve, reject),
      values: () => {
        values = true;
        return pending;
      },
    };
    return pending;
  };
  // A transaction occupies one connection; its own queries run on that connection.
  const begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      return await fn({
        unsafe: async (query: string) => {
          stats.started.push(query);
          await tick();
          return [{ query }];
        },
      });
    } finally {
      stats.inFlight--;
    }
  };
  const client = Object.assign(() => undefined, {
    unsafe,
    begin,
    options: { parsers: {}, serializers: {} },
  }) as unknown as postgres.Sql;
  return { client, stats };
}

describe("one query per connection", () => {
  it("never has more queries in flight than permits, and keeps their order", async () => {
    const { client, stats } = fakeClient();
    const gated = oneQueryPerConnection(client, 1);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => gated.unsafe(`q${i}`))
    );
    expect(stats.maxInFlight).toBe(1);
    expect(stats.started).toEqual(
      Array.from({ length: 10 }, (_, i) => `q${i}`)
    );
    expect(
      results.map((r) => (r as unknown as { query: string }[])[0].query)
    ).toEqual(stats.started);
  });

  it("allows as many parallel queries as connections", async () => {
    const { client, stats } = fakeClient();
    const gated = oneQueryPerConnection(client, 3);
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => gated.unsafe(`q${i}`))
    );
    expect(stats.maxInFlight).toBe(3);
  });

  it("supports .values() and starts each query once, only when awaited", async () => {
    const { client, stats } = fakeClient();
    const gated = oneQueryPerConnection(client, 1);
    const lazy = gated.unsafe("not awaited");
    await tick();
    expect(stats.started).toEqual([]);
    expect(await gated.unsafe("rows").values()).toEqual([["rows"]]);
    const once = gated.unsafe("once");
    await Promise.all([once, once]);
    expect(stats.started).toEqual(["rows", "once"]);
    void lazy;
  });

  it("releases the permit when a query fails", async () => {
    const { client, stats } = fakeClient();
    const gated = oneQueryPerConnection(client, 1);
    const [failed, next] = await Promise.allSettled([
      gated.unsafe("FAIL"),
      gated.unsafe("after"),
    ]);
    expect(failed.status).toBe("rejected");
    expect(next.status).toBe("fulfilled");
    expect(stats.maxInFlight).toBe(1);
  });

  it("holds one permit for a whole transaction; its own queries are not gated", async () => {
    const { client, stats } = fakeClient();
    const gated = oneQueryPerConnection(client, 1);
    const order: string[] = [];
    await Promise.all([
      gated.begin(async (tx) => {
        await tx.unsafe("inside 1");
        await tx.unsafe("inside 2");
        order.push("transaction done");
      }),
      gated.unsafe("outside").then(() => order.push("outside done")),
    ]);
    expect(order).toEqual(["transaction done", "outside done"]);
    expect(stats.maxInFlight).toBe(1);
  });

  it("passes everything else through to the client", () => {
    const { client } = fakeClient();
    expect(oneQueryPerConnection(client, 1).options).toBe(client.options);
  });

  it("is what Drizzle runs through: concurrent db.execute calls never overlap", async () => {
    const { client, stats } = fakeClient();
    const db = drizzle(oneQueryPerConnection(client, 1));
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        db.execute(sql`SELECT ${sql.raw(String(i))}`)
      )
    );
    expect(stats.started).toHaveLength(8);
    expect(stats.maxInFlight).toBe(1);
  });

  it("refuses a gate without permits", () => {
    expect(() => createGate(0)).toThrow();
  });
});
