// Proves the RLS policies from docs/UC-02_Data_and_Security.md sections 6-7
// (M2 security foundation, superseding docs/adr/0006) actually hold, using a
// real anon-key client against the real staging Supabase project — not
// mocks, not the privileged service connection.
// Required by CLAUDE.md's "Row-level security is not optional": every
// public-facing table needs an automated test that runs as the anon role,
// proving both what it can do and at least one thing it's correctly
// blocked from doing.
//
// Needs STAGING_SUPABASE_URL / STAGING_SUPABASE_ANON_KEY — see .env.example.
//
// M2 note: D07 retires the ADR-0006 raw anon INSERT policy — anon can no
// longer write to registrations at all, direct or otherwise. The only
// public write path is the private.register_for_event routine, called by
// the trusted server connection (app_runtime), never reachable from an
// anon-key PostgREST client. That routine's behavior is proven separately
// by disposable-database rehearsal (see docs/UC-02_Data_and_Security.md
// section 10's M2 rehearsal evidence) — testing it end-to-end through the
// app itself is M3's job, once lib/registrations calls it.
//
// Public event columns are also narrower now: anon's column grant is
// id/title/description/event_date/location only (status, committee_id,
// revision, capacity and the O-01 approval fields are never anon-readable),
// so these tests don't select status — visibility is proven by which rows
// come back at all, not by reading a status column anon can't see.

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
  it("anon can read a published event's public columns", async () => {
    const { data, error } = await anon
      .from("events")
      .select("id, title")
      .eq("id", PUBLISHED_EVENT_ID);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("anon cannot see the draft event — RLS filters it out silently, not an error", async () => {
    const { data, error } = await anon
      .from("events")
      .select("id, title")
      .eq("id", DRAFT_EVENT_ID);

    // This is RLS's most common failure mode, per CLAUDE.md: a missing or
    // wrong policy returns empty, not an error. Assert on the empty
    // result directly, not on `error` being set.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("anon cannot read non-public columns like status or committee_id", async () => {
    const { error } = await anon
      .from("events")
      .select("id, status")
      .eq("id", PUBLISHED_EVENT_ID);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("staging RLS: members (M2 — no grant at all, not just no policy)", () => {
  it("anon reading members is denied outright: no GRANT exists, so this is a permission error, not an empty RLS-filtered result", async () => {
    const { data, error } = await anon.from("members").select("id, email");

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("staging RLS: registrations (M2 — anon direct write retired, D07)", () => {
  it("anon cannot INSERT a registration directly anymore, even for a published event", async () => {
    const { error } = await anon.from("registrations").insert({
      event_id: PUBLISHED_EVENT_ID,
      attendee_name: "Should Be Rejected",
      attendee_email: "vitest-rls-reject-direct@example.com",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // insufficient_privilege — no grant at all now
  });

  it("anon cannot register for a draft event either", async () => {
    const { error } = await anon.from("registrations").insert({
      event_id: DRAFT_EVENT_ID,
      attendee_name: "Should Be Rejected",
      attendee_email: "vitest-rls-reject@example.com",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("anon cannot register with a non-null memberId either", async () => {
    const { error } = await anon.from("registrations").insert({
      event_id: PUBLISHED_EVENT_ID,
      attendee_name: "Should Also Be Rejected",
      attendee_email: "vitest-rls-reject-2@example.com",
      member_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("anon cannot read registrations at all — no grant, not just no policy", async () => {
    const { data, error } = await anon.from("registrations").select("id");

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
