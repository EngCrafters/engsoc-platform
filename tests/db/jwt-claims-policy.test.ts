import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, close, maintenanceDb, runtimeDb } from "./helpers";

/**
 * Supabase's PostgREST exposes the caller as the JSON `request.jwt.claims`
 * setting. The committee policy once read only the legacy
 * `request.jwt.claim.sub` setting, so a signed-in admin saw zero committees.
 * These tests set ONLY the JSON claims, exactly as the real API does.
 */
describe("committee visibility under real JWT claims", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const maintenance = maintenanceDb();
  afterAll(async () => close(admin, runtime, maintenance));

  const technical = randomUUID();
  const board = randomUUID();
  const manager = randomUUID();
  const outsider = randomUUID();
  let finance: string;

  beforeAll(async () => {
    await admin`INSERT INTO auth.users (id, email) VALUES
      (${technical}, 'claims-tech@example.test'),
      (${board}, 'claims-board@example.test'),
      (${manager}, 'claims-manager@example.test'),
      (${outsider}, 'claims-outsider@example.test')`;
    const [row] = await admin<{ id: string }[]>`
      SELECT id FROM public.committees WHERE slug = 'finance'`;
    finance = row.id;
    await maintenance`SELECT private.set_technical_access(${technical}::uuid, ${technical}::uuid, true)`;
    await runtime`SELECT private.change_administrative_access(
      ${technical}::uuid, ${board}::uuid, 'BOARD_ADMIN', NULL, 'grant')`;
    await runtime`SELECT private.change_administrative_access(
      ${technical}::uuid, ${manager}::uuid, 'COMMITTEE_MANAGER', ${finance}::uuid, 'grant')`;
  });

  async function visibleAs(userId: string | null, claims?: object) {
    const names = await admin.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      // Deliberately NOT request.jwt.claim.sub: only the JSON claims.
      await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(
          claims ?? (userId ? { sub: userId, role: "authenticated" } : {})
        ),
      ]);
      return tx<{ name: string }[]>`
        SELECT name FROM public.committees WHERE slug IS NOT NULL ORDER BY name`;
    });
    return names.map((row) => row.name);
  }

  // Other suites add committees to the shared database, so check that the
  // eight catalog committees are all visible rather than an exact total.
  const catalog = [
    "Evening Committee",
    "Finance Committee",
    "Forum Committee",
    "Media Committee",
    "Relations Committee",
    "Society Affairs Committee",
    "Support & Logistics Committee",
    "Technical Team",
  ];

  it("shows a Technical user every live committee", async () => {
    expect(await visibleAs(technical)).toEqual(expect.arrayContaining(catalog));
  });

  it("shows a Board Administration user every live committee", async () => {
    expect(await visibleAs(board)).toEqual(expect.arrayContaining(catalog));
  });

  it("shows a Committee Manager only their own committee", async () => {
    expect(await visibleAs(manager)).toEqual(["Finance Committee"]);
  });

  it("shows a user without access nothing", async () => {
    expect(await visibleAs(outsider)).toEqual([]);
  });

  it("shows nothing when the claims carry no subject", async () => {
    expect(await visibleAs(null, {})).toEqual([]);
    expect(await visibleAs(null, { sub: "" })).toEqual([]);
  });

  it("still honours the legacy claim setting used by older harnesses", async () => {
    const names = await admin.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [
        manager,
      ]);
      return tx<{ name: string }[]>`
        SELECT name FROM public.committees WHERE slug IS NOT NULL`;
    });
    expect(names.map((row) => row.name)).toEqual(["Finance Committee"]);
  });

  it("does not let one user read another user's grant", async () => {
    const rows = await admin.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: manager, role: "authenticated" }),
      ]);
      return tx<{ user_id: string }[]>`
        SELECT user_id FROM public.administrative_access`;
    });
    expect(rows.map((row) => row.user_id)).toEqual([manager]);
  });
});
