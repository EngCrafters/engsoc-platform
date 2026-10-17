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

describe("staging legacy manager isolation after access migration", () => {
  it.skipIf(!enabled || !configured)(
    "authenticates the prior Events manager without granting a final committee",
    async () => {
      const { error: loginError } = await client!.auth.signInWithPassword({
        email: email!,
        password: password!,
      });
      expect(loginError).toBeNull();

      const { data: grants, error: grantsError } = await client!
        .from("administrative_access")
        .select("committee_id, access_level, revoked_at");
      expect(grantsError).toBeNull();
      expect(grants).toHaveLength(1);
      expect(grants![0].access_level).toBe("COMMITTEE_MANAGER");
      expect(grants![0].revoked_at).not.toBeNull();

      const { data: committees, error: committeesError } = await client!
        .from("committees")
        .select("id, name");
      expect(committeesError).toBeNull();
      expect(committees).toEqual([]);
    }
  );
});

afterAll(async () => {
  if (client) await client.auth.signOut();
});
