import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  asAuthenticated,
  close,
  maintenanceDb,
  runtimeDb,
} from "./helpers";

describe("application access hierarchy", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const maintenance = maintenanceDb();
  afterAll(async () => close(admin, runtime, maintenance));

  const technical = randomUUID();
  const board = randomUUID();
  const manager = randomUUID();
  const outsider = randomUUID();
  let media: string;
  let finance: string;
  let eventId: string;

  it("has exactly eight live committees and isolates legacy Events", async () => {
    const catalog = await admin<{ slug: string }[]>`
      SELECT slug FROM public.committees
      WHERE slug IN ('support-logistics', 'relations', 'society-affairs',
        'finance', 'forum', 'evening', 'media', 'technical-team')
      ORDER BY slug
    `;
    expect(catalog.map((row) => row.slug)).toEqual([
      "evening",
      "finance",
      "forum",
      "media",
      "relations",
      "society-affairs",
      "support-logistics",
      "technical-team",
    ]);
    const rows = await admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM public.committees WHERE slug IN ('media', 'finance')
    `;
    media = rows.find((row) => row.slug === "media")!.id;
    finance = rows.find((row) => row.slug === "finance")!.id;
    const legacyId = process.env.UC02_TEST_LEGACY_COMMITTEE_ID!;
    const legacyManagerId = process.env.UC02_TEST_LEGACY_MANAGER_ID!;
    const legacyEventId = process.env.UC02_TEST_LEGACY_EVENT_ID!;
    const arabicRelationsId = process.env.UC02_TEST_ARABIC_RELATIONS_ID!;
    const [legacy] = await admin<{ id: string; slug: string | null }[]>`
      SELECT id, slug FROM public.committees WHERE id = ${legacyId}`;
    expect(legacy).toMatchObject({ id: legacyId, slug: null });
    const [relations] = await admin<{ id: string; name: string }[]>`
      SELECT id, name FROM public.committees WHERE slug = 'relations'`;
    expect(relations).toMatchObject({
      id: arabicRelationsId,
      name: "Relations Committee",
    });
    const [historical] = await admin<
      { committee_id: string; registration_id: string }[]
    >`
      SELECT e.committee_id, r.id AS registration_id
      FROM public.events e JOIN public.registrations r ON r.event_id = e.id
      WHERE e.id = ${process.env.UC02_TEST_ARABIC_EVENT_ID!}`;
    expect(historical).toMatchObject({
      committee_id: arabicRelationsId,
      registration_id: process.env.UC02_TEST_ARABIC_REGISTRATION_ID,
    });
    const [smoke] = await admin<{ committee_id: string; archived_at: Date }[]>`
      SELECT committee_id, archived_at FROM public.events
      WHERE id = ${legacyEventId}`;
    expect(smoke.committee_id).toBe(legacy.id);
    expect(smoke.archived_at).not.toBeNull();
    const [smokeRegistration] = await admin<{ event_id: string }[]>`
      SELECT event_id FROM public.registrations
      WHERE id = ${process.env.UC02_TEST_LEGACY_REGISTRATION_ID!}`;
    expect(smokeRegistration.event_id).toBe(legacyEventId);
    const [oldGrant] = await admin<{ revoked_at: Date }[]>`
      SELECT revoked_at FROM public.administrative_access
      WHERE user_id = ${legacyManagerId}`;
    expect(oldGrant.revoked_at).not.toBeNull();
    const [revokeAudit] = await admin<
      {
        changes: {
          previous: { committeeId: string };
          next: { active: boolean };
        };
      }[]
    >`
      SELECT changes FROM private.uc02_audit WHERE action = 'access.revoked'
        AND changes->>'userId' = ${legacyManagerId}`;
    expect(revokeAudit.changes.previous.committeeId).toBe(legacy.id);
    expect(revokeAudit.changes.next.active).toBe(false);
    await admin`INSERT INTO auth.users (id, email) VALUES
      (${technical}, 'technical@example.test'),
      (${board}, 'board@example.test'),
      (${manager}, 'manager@example.test'),
      (${outsider}, 'outsider@example.test')`;
    eventId = randomUUID();
    await admin`INSERT INTO public.events
      (id, title, description, event_date, committee_id, status)
      VALUES (${eventId}, 'Media event', 'Test event', now() + interval '7 days', ${media}, 'draft')`;
  });

  it("bootstraps Technical only through maintenance and grants Board and one manager", async () => {
    await expect(
      runtime`SELECT private.set_technical_access(${technical}::uuid, ${technical}::uuid, true)`
    ).rejects.toThrow();
    const bootstrap = await maintenance<{ result: { code: string } }[]>`
      SELECT private.set_technical_access(${technical}::uuid, ${technical}::uuid, true) AS result
    `;
    expect(bootstrap[0].result.code).toBe("SUCCESS");
    const boardGrant = await runtime<{ result: { code: string } }[]>`
      SELECT private.change_administrative_access(
        ${technical}::uuid, ${board}::uuid, 'BOARD_ADMIN', NULL, 'grant') AS result
    `;
    expect(boardGrant[0].result.code).toBe("SUCCESS");
    const managerGrant = await runtime<{ result: { code: string } }[]>`
      SELECT private.change_administrative_access(
        ${technical}::uuid, ${manager}::uuid, 'COMMITTEE_MANAGER', ${media}::uuid, 'grant') AS result
    `;
    expect(managerGrant[0].result.code).toBe("SUCCESS");
    const forbidden = await runtime<{ result: { code: string } }[]>`
      SELECT private.change_administrative_access(
        ${board}::uuid, ${outsider}::uuid, 'BOARD_ADMIN', NULL, 'grant') AS result
    `;
    expect(forbidden[0].result.code).toBe("FORBIDDEN");
    const [legacyGlobalCount] = await runtime<{ total_count: number }[]>`
      SELECT total_count FROM private.count_admin_events(${technical}::uuid, ${process.env.UC02_TEST_LEGACY_COMMITTEE_ID!}::uuid)`;
    expect(legacyGlobalCount.total_count).toBe(0);
    const [technicalAudit] = await runtime<{ action: string }[]>`
      SELECT action FROM private.list_access_audit(${technical}::uuid) LIMIT 1`;
    expect(technicalAudit.action).toBe("access.granted");
    const boardAudit = await runtime`
      SELECT * FROM private.list_access_audit(${board}::uuid)`;
    expect(boardAudit).toHaveLength(0);
    const users = await runtime<{ user_id: string }[]>`
      SELECT user_id FROM private.list_auth_users_for_access(${technical}::uuid)`;
    expect(users.map((row) => row.user_id)).toContain(manager);
    const boardUsers = await runtime`
      SELECT * FROM private.list_auth_users_for_access(${board}::uuid)`;
    expect(boardUsers).toHaveLength(0);
    const assignments = await runtime<
      { user_id: string; access_level: string }[]
    >`
      SELECT user_id, access_level FROM private.list_administrative_access(${technical}::uuid)`;
    expect(assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: board,
          access_level: "BOARD_ADMIN",
        }),
        expect.objectContaining({
          user_id: manager,
          access_level: "COMMITTEE_MANAGER",
        }),
      ])
    );
  });

  it("scopes manager reads and counts, while Board and Technical see global data", async () => {
    const otherEvent = randomUUID();
    await admin`INSERT INTO public.events
      (id, title, description, event_date, committee_id, status)
      VALUES (${otherEvent}, 'Finance event', 'Test event', now() + interval '7 days', ${finance}, 'draft')`;
    await admin`INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
      VALUES (${eventId}, 'Media Attendee', 'media@example.test', 'confirmed'),
        (${otherEvent}, 'Finance Attendee', 'finance@example.test', 'confirmed')`;
    const managerList = await runtime<{ id: string }[]>`
      SELECT id FROM private.list_admin_events(${manager}::uuid, NULL, 'all', NULL, NULL, 20)
    `;
    expect(managerList.map((row) => row.id)).toEqual([eventId]);
    for (const actor of [board, technical]) {
      for (const [committee, expected] of [
        [media, eventId],
        [finance, otherEvent],
      ]) {
        const rows = await runtime<{ id: string }[]>`
          SELECT id FROM private.list_admin_events(${actor}::uuid, ${committee}::uuid, 'all', NULL, NULL, 20)
        `;
        expect(rows.map((row) => row.id)).toContain(expected);
      }
    }
    const counts = await runtime<{ total_count: number }[]>`
      SELECT total_count FROM private.count_admin_events(${manager}::uuid, NULL)
    `;
    expect(counts[0].total_count).toBe(1);
    const global = await runtime<{ total_count: number }[]>`
      SELECT total_count FROM private.count_admin_events(${board}::uuid, NULL)
    `;
    expect(global[0].total_count).toBeGreaterThanOrEqual(2);
    const foreign = await runtime<{ id: string }[]>`
      SELECT id FROM private.get_admin_event(${manager}::uuid, ${otherEvent}::uuid)
    `;
    expect(foreign).toEqual([]);
    const noAccess = await runtime<{ id: string }[]>`
      SELECT id FROM private.list_admin_events(${outsider}::uuid, NULL, 'all', NULL, NULL, 20)
    `;
    expect(noAccess).toEqual([]);
    const own = await runtime<{ attendee_email: string }[]>`
      SELECT attendee_email FROM private.list_admin_registrations(${manager}::uuid, ${eventId}::uuid)`;
    expect(own.map((row) => row.attendee_email)).toEqual([
      "media@example.test",
    ]);
    const foreignRegistrations = await runtime<{ attendee_email: string }[]>`
      SELECT attendee_email FROM private.list_admin_registrations(${manager}::uuid, ${otherEvent}::uuid)`;
    expect(foreignRegistrations).toHaveLength(0);
    const foreignCount = await runtime`
      SELECT * FROM private.count_admin_registrations(${manager}::uuid, ${otherEvent}::uuid)`;
    expect(foreignCount).toHaveLength(0);
    const foreignExport = await runtime`
      SELECT * FROM private.export_admin_registrations(${manager}::uuid, ${otherEvent}::uuid, 'confirmed')`;
    expect(foreignExport).toHaveLength(0);
    for (const actor of [board, technical]) {
      const visible = await runtime<{ attendee_email: string }[]>`
        SELECT attendee_email FROM private.list_admin_registrations(${actor}::uuid, ${otherEvent}::uuid)`;
      expect(visible.map((row) => row.attendee_email)).toEqual([
        "finance@example.test",
      ]);
      const exported = await runtime<{ attendee_email: string }[]>`
        SELECT attendee_email FROM private.export_admin_registrations(${actor}::uuid, ${otherEvent}::uuid, 'confirmed')`;
      expect(exported.map((row) => row.attendee_email)).toEqual([
        "finance@example.test",
      ]);
      const browserCommittees = await asAuthenticated(
        admin,
        actor,
        () =>
          admin<
            { slug: string }[]
          >`SELECT slug FROM public.committees WHERE slug IS NOT NULL`
      );
      expect(browserCommittees.map((row) => row.slug)).toContain("forum");
      expect(browserCommittees.map((row) => row.slug)).toContain(
        "technical-team"
      );
      const browserRegistration = await asAuthenticated(
        admin,
        actor,
        () =>
          admin<
            { attendee_email: string }[]
          >`SELECT attendee_email FROM public.registrations WHERE event_id = ${otherEvent}`
      );
      expect(browserRegistration.map((row) => row.attendee_email)).toEqual([
        "finance@example.test",
      ]);
    }
    const managerBrowser = await asAuthenticated(
      admin,
      manager,
      () =>
        admin<
          { attendee_email: string }[]
        >`SELECT attendee_email FROM public.registrations WHERE event_id = ${otherEvent}`
    );
    expect(managerBrowser).toHaveLength(0);
    const outsiderBrowser = await asAuthenticated(
      admin,
      outsider,
      () => admin<{ id: string }[]>`SELECT id FROM public.committees`
    );
    expect(outsiderBrowser).toHaveLength(0);
    await asAuthenticated(admin, outsider, async () => {
      await expect(
        admin`SELECT private.can_access_committee(${technical}::uuid, ${media}::uuid)`
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("rejects a second committee grant and audits atomic reassignment", async () => {
    const duplicate = await runtime<{ result: { code: string } }[]>`
      SELECT private.change_administrative_access(
        ${technical}::uuid, ${manager}::uuid, 'COMMITTEE_MANAGER', ${finance}::uuid, 'grant') AS result
    `;
    expect(duplicate[0].result.code).toBe("REASSIGN_REQUIRED");
    const moved = await runtime<{ result: { code: string } }[]>`
      SELECT private.change_administrative_access(
        ${technical}::uuid, ${manager}::uuid, 'COMMITTEE_MANAGER', ${finance}::uuid, 'reassign') AS result
    `;
    expect(moved[0].result.code).toBe("SUCCESS");
    const row = await admin<{ committee_id: string }[]>`
      SELECT committee_id FROM public.administrative_access WHERE user_id = ${manager}
    `;
    expect(row[0].committee_id).toBe(finance);
    const audit = await admin<
      {
        changes: {
          previous: { committeeId: string };
          next: { committeeId: string };
        };
      }[]
    >`
      SELECT changes FROM private.uc02_audit WHERE action = 'access.reassigned'
        AND changes->>'userId' = ${manager} ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(audit[0].changes.previous.committeeId).toBe(media);
    expect(audit[0].changes.next.committeeId).toBe(finance);
  });

  it("keeps managerless committees operable for Board and Technical", async () => {
    const [forum] = await admin<{ id: string }[]>`
      SELECT id FROM public.committees WHERE slug = 'forum'`;
    const [managerCount] = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM public.administrative_access
      WHERE committee_id = ${forum.id} AND revoked_at IS NULL`;
    expect(managerCount.count).toBe(0);
    for (const actor of [board, technical]) {
      const [created] = await runtime<
        { result: { code: string; eventId: string } }[]
      >`
        SELECT private.create_event(${actor}::uuid, ${forum.id}::uuid,
          'Forum draft', 'Managerless committee', now() + interval '7 days', NULL, NULL) AS result`;
      expect(created.result.code).toBe("SUCCESS");
      const [detail] = await runtime<{ id: string }[]>`
        SELECT id FROM private.get_admin_event(${actor}::uuid, ${created.result.eventId}::uuid)`;
      expect(detail.id).toBe(created.result.eventId);
    }
  });

  it("enforces one-committee event, registration, count and export scope for each current manager committee", async () => {
    const slugs = ["support-logistics", "finance", "media"];
    const records: { actor: string; committee: string; event: string }[] = [];
    for (const slug of slugs) {
      const [catalog] = await admin<{ id: string }[]>`
        SELECT id FROM public.committees WHERE slug = ${slug}`;
      const actor = randomUUID();
      await admin`INSERT INTO auth.users (id, email) VALUES (${actor}, ${`${slug}-${actor}@example.test`})`;
      const [grant] = await runtime<{ result: { code: string } }[]>`
        SELECT private.change_administrative_access(${technical}::uuid, ${actor}::uuid,
          'COMMITTEE_MANAGER', ${catalog.id}::uuid, 'grant') AS result`;
      expect(grant.result.code).toBe("SUCCESS");
      const [created] = await runtime<
        { result: { code: string; eventId: string } }[]
      >`
        SELECT private.create_event(${actor}::uuid, ${catalog.id}::uuid,
          ${`${slug} event`}, 'Test description', now() + interval '7 days', NULL, NULL) AS result`;
      expect(created.result.code).toBe("SUCCESS");
      await admin`INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
        VALUES (${created.result.eventId}, 'Scoped attendee', ${`${slug}@example.test`}, 'confirmed')`;
      records.push({
        actor,
        committee: catalog.id,
        event: created.result.eventId,
      });
    }
    for (let i = 0; i < records.length; i += 1) {
      const own = records[i];
      const other = records[(i + 1) % records.length];
      const ownEvents = await runtime<{ id: string }[]>`
        SELECT id FROM private.list_admin_events(${own.actor}::uuid, NULL, 'all', NULL, NULL, 20)`;
      expect(ownEvents.map((row) => row.id)).toContain(own.event);
      expect(ownEvents.map((row) => row.id)).not.toContain(other.event);
      const [ownCount] = await runtime<{ total_count: number }[]>`
        SELECT total_count FROM private.count_admin_events(${own.actor}::uuid, ${own.committee}::uuid)`;
      expect(ownCount.total_count).toBeGreaterThanOrEqual(1);
      const [ownRegistrations] = await runtime<{ confirmed_count: number }[]>`
        SELECT confirmed_count FROM private.count_admin_registrations(${own.actor}::uuid, ${own.event}::uuid)`;
      expect(ownRegistrations.confirmed_count).toBe(1);
      const ownExport = await runtime<{ attendee_email: string }[]>`
        SELECT attendee_email FROM private.export_admin_registrations(${own.actor}::uuid, ${own.event}::uuid, 'confirmed')`;
      expect(ownExport).toHaveLength(1);
      const foreignEvents = await runtime`
        SELECT id FROM private.get_admin_event(${own.actor}::uuid, ${other.event}::uuid)`;
      expect(foreignEvents).toHaveLength(0);
      const foreignExport = await runtime`
        SELECT id FROM private.export_admin_registrations(${own.actor}::uuid, ${other.event}::uuid, 'confirmed')`;
      expect(foreignExport).toHaveLength(0);
      const [reviewFlag] = await runtime<{ result: { code: string } }[]>`
        SELECT private.flag_review(${own.actor}::uuid, ${own.event}::uuid, 1, true) AS result`;
      expect(reviewFlag.result.code).toBe("SUCCESS");
    }
  });

  it("allows different Board or Technical review, denies manager and self-review", async () => {
    const flag = await runtime<
      { result: { code: string; revision: number } }[]
    >`
      SELECT private.flag_review(${technical}::uuid, ${eventId}::uuid, 1, true) AS result
    `;
    expect(flag[0].result.code).toBe("SUCCESS");
    const self = await runtime<{ result: { code: string } }[]>`
      SELECT private.approve_event(${technical}::uuid, ${eventId}::uuid, 2) AS result
    `;
    expect(self[0].result.code).toBe("SELF_APPROVAL_DENIED");
    const denied = await runtime<{ result: { code: string } }[]>`
      SELECT private.approve_event(${manager}::uuid, ${eventId}::uuid, 2) AS result
    `;
    expect(denied[0].result.code).toBe("NOT_FOUND");
    const approved = await runtime<{ result: { code: string } }[]>`
      SELECT private.approve_event(${board}::uuid, ${eventId}::uuid, 2) AS result
    `;
    expect(approved[0].result.code).toBe("SUCCESS");
    const rejected = await runtime<{ result: { code: string } }[]>`
      SELECT private.reject_review(${board}::uuid, ${eventId}::uuid, 2, 'Revise details') AS result
    `;
    expect(rejected[0].result.code).toBe("SUCCESS");
    const audit = await admin<
      {
        action: string;
        actor_user_id: string;
        committee_id: string;
        occurred_at: Date;
        changes: {
          previous: { approvedBy: string | null };
          next: { approvedBy: string | null };
        };
      }[]
    >`
      SELECT action, actor_user_id, committee_id, occurred_at, changes
      FROM private.uc02_audit WHERE event_id = ${eventId}
        AND action IN ('event.approved','event.review_rejected') ORDER BY occurred_at
    `;
    expect(audit.map((row) => row.action)).toEqual([
      "event.approved",
      "event.review_rejected",
    ]);
    expect(audit[0]).toMatchObject({
      actor_user_id: board,
      committee_id: media,
      changes: { previous: { approvedBy: null }, next: { approvedBy: board } },
    });
    expect(audit[1]).toMatchObject({
      actor_user_id: board,
      committee_id: media,
      changes: { previous: { approvedBy: board }, next: { approvedBy: null } },
    });
    expect(audit[0].occurred_at).toBeInstanceOf(Date);
  });
});
