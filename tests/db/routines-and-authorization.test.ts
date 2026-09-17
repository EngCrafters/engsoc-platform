import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  asAuthenticated,
  callRoutine,
  close,
  createFixture,
  registration,
  runtimeDb,
} from "./helpers";

describe("UC-02 private routines and authorization", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  it("creates only a manager-scoped draft and records one audit row", async () => {
    const fixture = await createFixture(admin);
    const eventDate = new Date(Date.now() + 172_800_000).toISOString();

    expect(
      await callRoutine(runtime, "create_event", [
        fixture.otherManagerId,
        fixture.committeeId,
        "Foreign draft",
        null,
        eventDate,
        null,
        null,
      ])
    ).toMatchObject({ code: "NOT_FOUND" });

    const created = await callRoutine(runtime, "create_event", [
      fixture.managerId,
      fixture.committeeId,
      "  New event  ",
      "",
      eventDate,
      "",
      20,
    ]);
    expect(created).toMatchObject({ code: "SUCCESS", revision: 1 });
    expect(created.eventId).toEqual(expect.any(String));

    const [event] = await admin<
      [
        {
          title: string;
          status: string;
          description: string | null;
          location: string | null;
        },
      ]
    >`SELECT title, status, description, location FROM public.events WHERE id = ${created.eventId!}`;
    expect(event).toEqual({
      title: "New event",
      status: "draft",
      description: null,
      location: null,
    });
    const audit = await admin`
      SELECT action, actor_kind, actor_user_id, committee_id, changes
      FROM private.uc02_audit WHERE event_id = ${created.eventId!}
    `;
    expect(audit).toEqual([
      expect.objectContaining({
        action: "event.created",
        actor_kind: "authenticated",
        actor_user_id: fixture.managerId,
        committee_id: fixture.committeeId,
        changes: expect.objectContaining({
          after: expect.objectContaining({
            title: "New event",
            status: "draft",
          }),
        }),
      }),
    ]);
  });

  it("edits with optimistic revision, preserves review invalidation, and denies forbidden changes", async () => {
    const fixture = await createFixture(admin);
    const eventDate = new Date(Date.now() + 172_800_000).toISOString();
    expect(
      await callRoutine(runtime, "edit_event", [
        fixture.otherManagerId,
        fixture.eventId,
        1,
        "Foreign edit",
        "A complete test event description.",
        eventDate,
        null,
        null,
      ])
    ).toMatchObject({ code: "NOT_FOUND" });

    await callRoutine(runtime, "flag_review", [
      fixture.managerId,
      fixture.eventId,
      1,
      true,
    ]);
    await callRoutine(runtime, "approve_event", [
      fixture.reviewerId,
      fixture.eventId,
      2,
    ]);
    expect(
      await callRoutine(runtime, "edit_event", [
        fixture.managerId,
        fixture.eventId,
        2,
        "Updated title",
        "Updated description",
        eventDate,
        "Muscat",
        10,
      ])
    ).toMatchObject({ code: "SUCCESS", revision: 3 });
    const [updated] = await admin<
      [
        {
          title: string;
          approved_by: string | null;
          approved_revision: number | null;
        },
      ]
    >`SELECT title, approved_by, approved_revision FROM public.events WHERE id = ${fixture.eventId}`;
    expect(updated).toEqual({
      title: "Updated title",
      approved_by: null,
      approved_revision: null,
    });
    const [editAudit] = await admin`
      SELECT changes FROM private.uc02_audit
      WHERE event_id = ${fixture.eventId} AND action = 'event.updated'
    `;
    expect(editAudit.changes).toEqual(
      expect.objectContaining({
        before: expect.objectContaining({
          title: "UC-02 test event",
          revision: 2,
        }),
        after: expect.objectContaining({ title: "Updated title", revision: 3 }),
      })
    );
    expect(
      await callRoutine(runtime, "edit_event", [
        fixture.managerId,
        fixture.eventId,
        2,
        "Stale edit",
        "Updated description",
        eventDate,
        "Muscat",
        10,
      ])
    ).toMatchObject({ code: "CONFLICT", currentRevision: 3 });
  });

  it("denies create and edit after a manager grant is revoked", async () => {
    const fixture = await createFixture(admin);
    await admin`
      UPDATE public.committee_managers
      SET revoked_at = now(), revoked_by = ${fixture.managerId}
      WHERE user_id = ${fixture.managerId} AND committee_id = ${fixture.committeeId}
    `;
    const futureDate = new Date(Date.now() + 172_800_000).toISOString();
    expect(
      await callRoutine(runtime, "create_event", [
        fixture.managerId,
        fixture.committeeId,
        "Revoked create",
        null,
        futureDate,
        null,
        null,
      ])
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await callRoutine(runtime, "edit_event", [
        fixture.managerId,
        fixture.eventId,
        1,
        "Revoked edit",
        "A complete test event description.",
        futureDate,
        null,
        null,
      ])
    ).toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces committee scope, review, self-approval denial, approval, and publication", async () => {
    const fixture = await createFixture(admin);

    expect(
      await callRoutine(runtime, "flag_review", [
        fixture.otherManagerId,
        fixture.eventId,
        1,
        true,
      ])
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await callRoutine(runtime, "flag_review", [
        fixture.managerId,
        fixture.eventId,
        1,
        true,
      ])
    ).toMatchObject({
      code: "SUCCESS",
      revision: 2,
    });
    expect(
      await callRoutine(runtime, "approve_event", [
        fixture.managerId,
        fixture.eventId,
        2,
      ])
    ).toMatchObject({
      code: "SELF_APPROVAL_DENIED",
    });
    expect(
      await callRoutine(runtime, "approve_event", [
        fixture.reviewerId,
        fixture.eventId,
        2,
      ])
    ).toMatchObject({
      code: "SUCCESS",
      revision: 2,
    });
    expect(
      await callRoutine(runtime, "publish_event", [
        fixture.managerId,
        fixture.eventId,
        2,
      ])
    ).toMatchObject({
      code: "SUCCESS",
      revision: 3,
    });

    const [{ status, approved_by: approvedBy }] = await admin<
      [{ status: string; approved_by: string }]
    >`SELECT status, approved_by FROM public.events WHERE id = ${fixture.eventId}`;
    expect(status).toBe("published");
    expect(approvedBy).toBe(fixture.reviewerId);
    const audit = await admin`
      SELECT action FROM private.uc02_audit
      WHERE event_id = ${fixture.eventId} ORDER BY occurred_at, id
    `;
    expect(audit.map((row) => row.action)).toEqual([
      "event.review_flagged",
      "event.approved",
      "event.published",
    ]);
  });

  it("invalidates approval when the event revision changes and denies invalid transitions", async () => {
    const fixture = await createFixture(admin);
    await callRoutine(runtime, "flag_review", [
      fixture.managerId,
      fixture.eventId,
      1,
      true,
    ]);
    await callRoutine(runtime, "approve_event", [
      fixture.reviewerId,
      fixture.eventId,
      2,
    ]);
    await admin`UPDATE public.events SET revision = revision + 1 WHERE id = ${fixture.eventId}`;

    expect(
      await callRoutine(runtime, "publish_event", [
        fixture.managerId,
        fixture.eventId,
        3,
      ])
    ).toMatchObject({
      code: "APPROVAL_REQUIRED",
    });
    expect(
      await callRoutine(runtime, "approve_event", [
        fixture.reviewerId,
        fixture.eventId,
        1,
      ])
    ).toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await callRoutine(runtime, "approve_event", [
        fixture.otherManagerId,
        fixture.eventId,
        3,
      ])
    ).toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("holds a published event full and archives/restores only valid lifecycle states", async () => {
    const held = await createFixture(admin, { status: "published" });
    expect(
      await callRoutine(runtime, "hold_event_full", [
        held.managerId,
        held.eventId,
        1,
      ])
    ).toMatchObject({
      code: "SUCCESS",
      revision: 2,
    });
    expect(
      await callRoutine(runtime, "archive_event", [
        held.managerId,
        held.eventId,
        2,
      ])
    ).toMatchObject({
      code: "INVALID_TRANSITION",
    });

    const archived = await createFixture(admin);
    expect(
      await callRoutine(runtime, "archive_event", [
        archived.managerId,
        archived.eventId,
        1,
      ])
    ).toMatchObject({
      code: "SUCCESS",
      revision: 2,
    });
    expect(
      await callRoutine(runtime, "restore_event", [
        archived.managerId,
        archived.eventId,
        2,
      ])
    ).toMatchObject({
      code: "SUCCESS",
      revision: 3,
    });
    expect(
      await callRoutine(runtime, "restore_event", [
        archived.managerId,
        archived.eventId,
        3,
      ])
    ).toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("enforces authenticated RLS reads for same-committee managers and denies cross-committee access", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    await registration(
      runtime,
      fixture.eventId,
      "rls@example.test",
      "register",
      "198.51.100.90"
    );
    const sameCommittee = await asAuthenticated(
      admin,
      fixture.managerId,
      async () =>
        admin`SELECT id FROM public.events WHERE id = ${fixture.eventId}`
    );
    expect(sameCommittee).toHaveLength(1);
    const sameRegistrations = await asAuthenticated(
      admin,
      fixture.managerId,
      async () =>
        admin`SELECT attendee_email FROM public.registrations WHERE event_id = ${fixture.eventId}`
    );
    expect(sameRegistrations).toEqual([{ attendee_email: "rls@example.test" }]);

    const foreignCommittee = await asAuthenticated(
      admin,
      fixture.otherManagerId,
      async () =>
        admin`SELECT id FROM public.events WHERE id = ${fixture.eventId}`
    );
    expect(foreignCommittee).toHaveLength(0);
    const foreignRegistrations = await asAuthenticated(
      admin,
      fixture.otherManagerId,
      async () =>
        admin`SELECT attendee_email FROM public.registrations WHERE event_id = ${fixture.eventId}`
    );
    expect(foreignRegistrations).toHaveLength(0);
    await asAuthenticated(admin, fixture.otherManagerId, async () => {
      await expect(
        admin`UPDATE public.events SET title = 'Denied' WHERE id = ${fixture.eventId}`
      ).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("re-evaluates a revoked manager grant and prevents self-grant changes", async () => {
    const fixture = await createFixture(admin, { status: "published" });

    const beforeRevocation = await asAuthenticated(
      admin,
      fixture.managerId,
      async () =>
        admin`SELECT id FROM public.events WHERE id = ${fixture.eventId}`
    );
    expect(beforeRevocation).toHaveLength(1);

    await asAuthenticated(admin, fixture.managerId, async () => {
      await expect(
        admin`UPDATE public.committee_managers SET revoked_at = now(), revoked_by = ${fixture.managerId} WHERE user_id = ${fixture.managerId} AND committee_id = ${fixture.committeeId}`
      ).rejects.toMatchObject({ code: "42501" });
    });

    await admin`
      UPDATE public.committee_managers
      SET revoked_at = now(), revoked_by = ${fixture.managerId}
      WHERE user_id = ${fixture.managerId} AND committee_id = ${fixture.committeeId}
    `;

    const afterRevocation = await asAuthenticated(
      admin,
      fixture.managerId,
      async () =>
        admin`SELECT id FROM public.events WHERE id = ${fixture.eventId}`
    );
    expect(afterRevocation).toHaveLength(0);
  });

  it("writes one audit row on success, none on failed transitions, and rolls back audit with business data", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    const before =
      await admin`SELECT count(*)::int AS count FROM private.uc02_audit WHERE event_id = ${fixture.eventId}`;
    expect(
      await callRoutine(runtime, "archive_event", [
        fixture.managerId,
        fixture.eventId,
        1,
      ])
    ).toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const afterFailure =
      await admin`SELECT count(*)::int AS count FROM private.uc02_audit WHERE event_id = ${fixture.eventId}`;
    expect(afterFailure[0].count).toBe(before[0].count);

    await expect(
      runtime.begin(async (transaction) => {
        const result = await registration(
          transaction,
          fixture.eventId,
          "rollback@example.test",
          "register",
          "198.51.100.92"
        );
        expect(result.code).toBe("SUCCESS");
        throw new Error("intentional test rollback");
      })
    ).rejects.toThrow("intentional test rollback");
    const registrations =
      await admin`SELECT count(*)::int AS count FROM public.registrations WHERE event_id = ${fixture.eventId}`;
    const audit =
      await admin`SELECT count(*)::int AS count FROM private.uc02_audit WHERE event_id = ${fixture.eventId}`;
    expect(registrations[0].count).toBe(0);
    expect(audit[0].count).toBe(before[0].count);
  });
});
