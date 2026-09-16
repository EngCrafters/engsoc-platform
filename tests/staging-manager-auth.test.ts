import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.RUN_STAGING_MANAGER_AUTH_TESTS === "true";
const url = process.env.STAGING_SUPABASE_URL;
const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
const email = process.env.STAGING_M5_MANAGER_EMAIL;
const password = process.env.STAGING_M5_MANAGER_PASSWORD;
const configured = Boolean(url && anonKey && email && password);

const client = configured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

describe("staging M5 manager JWT boundary", () => {
  it.skipIf(!enabled || !configured)(
    "authenticates the named manager and exposes only its active grants",
    async () => {
      const { error: loginError } = await client!.auth.signInWithPassword({
        email: email!,
        password: password!,
      });
      expect(loginError).toBeNull();

      const { data: grants, error: grantsError } = await client!
        .from("committee_managers")
        .select("committee_id")
        .is("revoked_at", null);
      expect(grantsError).toBeNull();
      expect(grants).toHaveLength(1);

      const { data: committees, error: committeesError } = await client!
        .from("committees")
        .select("id, name")
        .in(
          "id",
          (grants ?? []).map((grant) => grant.committee_id)
        );
      expect(committeesError).toBeNull();
      expect(committees).toEqual([
        { id: grants![0].committee_id, name: "Events" },
      ]);
    }
  );
});

afterAll(async () => {
  if (client) await client.auth.signOut();
});
