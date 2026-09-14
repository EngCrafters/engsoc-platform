// Proves the RLS policies from docs/adr/0006-staging-rls-for-anon-landing-page.md
// actually hold, using a real anon-key client against the real staging
// Supabase project — not mocks, not the privileged service connection.
// Required by CLAUDE.md's "Row-level security is not optional": every
// public-facing table needs an automated test that runs as the anon role,
// proving both what it can do and at least one thing it's correctly
// blocked from doing.
//
// Needs STAGING_SUPABASE_URL / STAGING_SUPABASE_ANON_KEY — see .env.example.
// Deliberately not the main project's env vars: main doesn't have these
// policies (see the ADR's Consequences section on that asymmetry).
//
// Known limitation: no staging service_role key is available yet, so this
// suite can't clean up after itself the way the "right" version of this
// test would (service-role client for setup/teardown, anon client only for
// the assertions under test). The "anon can register" test below leaves
// one real, permanent row in staging every time this suite runs — harmless
// (staging only, clearly marked attendeeEmail), but real. Revisit once a
// staging service_role key exists.

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.STAGING_SUPABASE_URL;
const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "STAGING_SUPABASE_URL and STAGING_SUPABASE_ANON_KEY must be set to run this suite — see .env.example."
  );
}

const anon = createClient(url, anonKey);

// Fixed ids from the staging project's seed data — see docs/adr/0006 and
// the seeding notes in db/migrations/. If staging ever gets re-seeded,
// update these to match.
const PUBLISHED_EVENT_ID = "086c89c9-7cb4-4dac-9b6e-d6e43fc304bb"; // Intro to Robotics Workshop
const DRAFT_EVENT_ID = "f8a57444-79a2-4ac6-baf3-20a065ea39e3"; // Committee Planning Retreat (Draft)

describe("staging RLS: events", () => {
  it("anon can read a published event", async () => {
    const { data, error } = await anon
      .from("events")
      .select("id, status")
      .eq("id", PUBLISHED_EVENT_ID);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("published");
  });

  it("anon cannot see the draft event — RLS filters it out silently, not an error", async () => {
    const { data, error } = await anon
      .from("events")
      .select("id, status")
      .eq("id", DRAFT_EVENT_ID);

    // This is RLS's most common failure mode, per CLAUDE.md: a missing or
    // wrong policy returns empty, not an error. Assert on the empty
    // result directly, not on `error` being set.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("staging RLS: members (no anon policy at all — fully closed)", () => {
  it("anon reading members returns nothing, not an error", async () => {
    const { data, error } = await anon.from("members").select("id, email");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("staging RLS: registrations", () => {
  it("anon can register for a published event with memberId left null", async () => {
    const { error } = await anon.from("registrations").insert({
      event_id: PUBLISHED_EVENT_ID,
      attendee_name: "Vitest RLS Test",
      attendee_email: "vitest-rls-test@example.com",
    });

    expect(error).toBeNull();
  });

  it("anon cannot register for a draft event", async () => {
    const { error } = await anon.from("registrations").insert({
      event_id: DRAFT_EVENT_ID,
      attendee_name: "Should Be Rejected",
      attendee_email: "vitest-rls-reject@example.com",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // insufficient_privilege — the RLS WITH CHECK failed
  });

  it("anon cannot register with a non-null memberId, even for a published event", async () => {
    const { error } = await anon.from("registrations").insert({
      event_id: PUBLISHED_EVENT_ID,
      attendee_name: "Should Also Be Rejected",
      attendee_email: "vitest-rls-reject-2@example.com",
      member_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
