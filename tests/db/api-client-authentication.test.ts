import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { adminDb, close, runtimeDb } from "./helpers";

const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: state.execute } }));
const { authenticate, hashToken } = await import("@/lib/api/auth");

describe("API token verification through restricted runtime", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const client = drizzle(runtime);
  beforeAll(() => {
    state.execute.mockImplementation((query) => client.execute(query));
  });
  afterAll(async () => close(admin, runtime));

  it.each([false, true])(
    "finds the stored delimiter with prefix underscores=%s",
    async (prefixUnderscore) => {
      const prefix =
        randomUUID().replaceAll("-", "").slice(0, 8) +
        (prefixUnderscore ? "_part" : "");
      const token = `essq_test_${prefix}_abcdefghi_${"a".repeat(33)}`;
      const id = randomUUID();
      await admin`INSERT INTO private.api_clients (id,name,key_prefix,key_hash,environment,scopes)
      VALUES (${id}, 'Synthetic parser regression', ${prefix}, ${hashToken(token)}, 'staging', ARRAY['events:read']);`;
      const request = (value: string) =>
        new Request("https://api.example/v1/events", {
          headers: { authorization: `Bearer ${value}` },
        });
      expect(await authenticate(request(token))).toEqual({
        ok: true,
        client: { id, name: "Synthetic parser regression" },
      });
      expect(await authenticate(request(token), "other:read")).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(await authenticate(request(token + "b"))).toEqual({
        ok: false,
        reason: "unauthorized",
      });
      await admin`UPDATE private.api_clients SET active=false WHERE id=${id};`;
      expect(await authenticate(request(token))).toEqual({
        ok: false,
        reason: "unauthorized",
      });
    }
  );
});
