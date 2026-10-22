import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminDb,
  runtimeDb,
  close,
  createFixture,
  registration,
} from "./helpers";

describe("administration (0032, real restricted roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(() => close(admin, runtime));
  let seq = 0;
  const ip = () => `198.32.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;
  async function call(fn: string, values: unknown[]) {
    const rows = await runtime.unsafe(
      `SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return rows[0].result;
  }
  async function user(email?: string) {
    const id = randomUUID();
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${email ?? `${id}@example.test`},now())`;
    return id;
  }
  async function senior(level: "BOARD_ADMIN" | "TECHNICAL") {
    const id = await user();
    await admin`INSERT INTO public.administrative_access(user_id,access_level,granted_by) VALUES(${id},${level},${id})`;
    return id;
  }
  async function member(options: { application?: boolean } = {}) {
    const id = randomUUID();
    const studentId = String(
      10_000_000 + Math.floor(Math.random() * 89_999_999)
    );
    const email = `adm${studentId}@squ.edu.om`;
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${email},now())`;
    await admin`INSERT INTO public.members(id,full_name,email,university_id,year,major) VALUES(${id},'Synthetic Admin Member',${email},${studentId},2,'mechanical')`;
    let applicationId: string | null = null;
    if (options.application) {
      const [app] =
        await admin`INSERT INTO private.membership_applications (full_name,email,university_id,academic_year,discipline,interests,consent_version,status_token_hash,auth_user_id,member_id,status,decided_by,decided_at,activated_at)
        VALUES ('Synthetic Admin Member',${email},${studentId},2,'mechanical',ARRAY['data'],'2026-10-v1',${randomBytes(32).toString("hex")},${id},${id},'approved',${await user()},now(),now()) RETURNING id`;
      applicationId = app.id;
    }
    return { id, email, studentId, applicationId };
  }
  const committeeBySlug = async (slug: string) =>
    (await admin`SELECT id FROM public.committees WHERE slug = ${slug}`)[0]
      .id as string;
  const audit = (action: string, committee: string) =>
    admin`SELECT * FROM private.uc02_audit WHERE action = ${action} AND committee_id = ${committee}`;

  it("lets senior administrators create, edit, archive and restore committees, never delete them", async () => {
    const board = await senior("BOARD_ADMIN");
    const f = await createFixture(admin);
    const slug = `adm-${randomBytes(3).toString("hex")}`;
    const created = await call("admin_create_committee", [
      board,
      `Synthetic ${slug}`,
      slug,
      "Runs synthetic things.",
    ]);
    expect(created.code).toBe("SUCCESS");
    const id = created.id as string;
    expect(
      (
        await call("admin_create_committee", [
          board,
          `SYNTHETIC ${slug.toUpperCase()}`,
          `${slug}-2`,
          null,
        ])
      ).code
    ).toBe("NAME_TAKEN");
    expect(
      (await call("admin_create_committee", [board, "Another", slug, null]))
        .code
    ).toBe("SLUG_TAKEN");
    expect(
      (await call("admin_create_committee", [board, "Bad", "Bad Slug", null]))
        .field
    ).toBe("slug");
    expect(
      (await call("admin_create_committee", [f.managerId, "X1", "x-1", null]))
        .code
    ).toBe("FORBIDDEN");

    expect(
      (
        await call("admin_update_committee", [
          board,
          id,
          `Renamed ${slug}`,
          "New responsibilities.",
        ])
      ).code
    ).toBe("SUCCESS");
    const [row] =
      await admin`SELECT name, slug, description FROM public.committees WHERE id = ${id}`;
    expect(row).toMatchObject({
      name: `Renamed ${slug}`,
      slug,
      description: "New responsibilities.",
    });

    // A manager blocks archiving; once revoked, archiving and restoring work.
    const manager = await user();
    expect(
      (
        await call("change_administrative_access", [
          board,
          manager,
          "COMMITTEE_MANAGER",
          id,
          "grant",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      await call("admin_set_committee_archived", [board, id, true])
    ).toMatchObject({ code: "BLOCKED", managers: 1 });
    expect(
      (
        await call("change_administrative_access", [
          board,
          manager,
          "COMMITTEE_MANAGER",
          id,
          "revoke",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("admin_set_committee_archived", [board, id, true])).code
    ).toBe("SUCCESS");
    // Archived: no new grants, roster changes or events; records stay.
    expect(
      (
        await call("change_administrative_access", [
          board,
          manager,
          "COMMITTEE_MANAGER",
          id,
          "grant",
          null,
        ])
      ).code
    ).toBe("COMMITTEE_ARCHIVED");
    await expect(
      admin`INSERT INTO public.events (title, event_date, committee_id) VALUES ('Blocked', now() + interval '1 day', ${id})`
    ).rejects.toThrow(/archived/);
    expect(
      (await call("admin_set_committee_archived", [board, id, false])).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("admin_set_committee_archived", [
          board,
          await committeeBySlug("society-affairs"),
          true,
        ])
      ).code
    ).toBe("PROTECTED_COMMITTEE");
    expect(
      (await audit("committee.archived", id)).map((a) => a.action)
    ).toEqual(["committee.archived"]);
    expect(await audit("committee.created", id)).toHaveLength(1);
    // There is no committee deletion routine at all.
    const [deleters] = await admin`SELECT count(*)::int AS n FROM pg_proc
      WHERE pronamespace = 'private'::regnamespace AND proname ~ 'delete.*committee'`;
    expect(deleters.n).toBe(0);
  });

  it("keeps a committee roster that grants nothing", async () => {
    const board = await senior("BOARD_ADMIN");
    const f = await createFixture(admin);
    const m = await member();
    const add = (op: string, resp: string | null) =>
      call("admin_change_committee_member", [
        board,
        f.committeeId,
        m.id,
        op,
        resp,
      ]);
    expect((await add("add", "Design lead")).code).toBe("SUCCESS");
    expect((await add("add", null)).code).toBe("ALREADY_ADDED");
    expect((await add("update", "Logistics")).code).toBe("SUCCESS");
    expect((await add("update", "Logistics")).code).toBe("UNCHANGED");
    const detail = await call("admin_get_committee", [board, f.committeeId]);
    expect(detail.members).toEqual([
      expect.objectContaining({ memberId: m.id, responsibility: "Logistics" }),
    ]);
    // Being on the roster is not access.
    const [access] =
      await admin`SELECT count(*)::int AS n FROM public.administrative_access WHERE user_id = ${m.id}`;
    expect(access.n).toBe(0);
    expect((await add("remove", null)).code).toBe("SUCCESS");
    expect(
      (
        await call("admin_change_committee_member", [
          board,
          f.committeeId,
          randomUUID(),
          "add",
          null,
        ])
      ).code
    ).toBe("MEMBER_NOT_FOUND");
    expect(
      (
        await call("admin_change_committee_member", [
          f.managerId,
          f.committeeId,
          m.id,
          "add",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
  });

  it("gives Board Administration manager-level access changes only, never escalation", async () => {
    const board = await senior("BOARD_ADMIN");
    const otherBoard = await senior("BOARD_ADMIN");
    const technical = await senior("TECHNICAL");
    const f = await createFixture(admin);
    const target = await user();
    const change = (
      actor: string,
      u: string,
      level: string,
      c: string | null,
      op: string
    ) => call("change_administrative_access", [actor, u, level, c, op, null]);

    expect(
      (await change(board, target, "COMMITTEE_MANAGER", f.committeeId, "grant"))
        .code
    ).toBe("SUCCESS");
    expect(
      (
        await change(
          board,
          target,
          "COMMITTEE_MANAGER",
          f.otherCommitteeId,
          "reassign"
        )
      ).code
    ).toBe("SUCCESS");
    expect(
      (await change(board, await user(), "BOARD_ADMIN", null, "grant")).code
    ).toBe("FORBIDDEN");
    expect(
      (await change(board, otherBoard, "BOARD_ADMIN", null, "revoke")).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await change(
          board,
          otherBoard,
          "COMMITTEE_MANAGER",
          f.committeeId,
          "grant"
        )
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (await change(board, board, "COMMITTEE_MANAGER", f.committeeId, "grant"))
        .code
    ).toBe("VALIDATION_ERROR");
    expect(
      (
        await change(
          f.managerId,
          target,
          "COMMITTEE_MANAGER",
          f.committeeId,
          "revoke"
        )
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("change_technical_access", [
          board,
          await user(),
          "grant",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");

    // Leadership transfer by Board Administration.
    const successor = await user();
    expect(
      (
        await call("replace_committee_manager", [
          board,
          target,
          successor,
          f.otherCommitteeId,
          "handover",
        ])
      ).code
    ).toBe("SUCCESS");

    // Suspension: immediate, remembered, and restorable only as it was.
    expect(
      (await call("set_access_suspension", [board, successor, true, "leave"]))
        .code
    ).toBe("SUCCESS");
    const [suspended] =
      await admin`SELECT revoked_at, revocation_kind FROM public.administrative_access WHERE user_id = ${successor}`;
    expect(suspended.revoked_at).not.toBeNull();
    expect(suspended.revocation_kind).toBe("suspended");
    const [locked] =
      await admin`SELECT private.lock_committee_access(${successor}::uuid, ${f.otherCommitteeId}::uuid) AS ok`;
    expect(locked.ok).toBe(false);
    expect(
      (await call("set_access_suspension", [board, successor, false, null]))
        .code
    ).toBe("SUCCESS");
    const [restored] =
      await admin`SELECT access_level, committee_id, revoked_at, revocation_kind FROM public.administrative_access WHERE user_id = ${successor}`;
    expect(restored).toMatchObject({
      access_level: "COMMITTEE_MANAGER",
      committee_id: f.otherCommitteeId,
      revoked_at: null,
      revocation_kind: null,
    });
    // An ordinary revocation (through the older routine) is not reactivatable.
    expect(
      (
        await change(
          board,
          successor,
          "COMMITTEE_MANAGER",
          f.otherCommitteeId,
          "revoke"
        )
      ).code
    ).toBe("SUCCESS");
    const [revoked] =
      await admin`SELECT revocation_kind FROM public.administrative_access WHERE user_id = ${successor}`;
    expect(revoked.revocation_kind).toBe("revoked");
    expect(
      (await call("set_access_suspension", [board, successor, false, null]))
        .code
    ).toBe("NOT_SUSPENDED");
    expect(
      (await call("set_access_suspension", [board, technical, true, null])).code
    ).toBe("FORBIDDEN");
    expect(
      (await call("set_access_suspension", [board, board, true, null])).code
    ).toBe("SELF_CHANGE");
    expect(
      (await call("set_access_suspension", [technical, otherBoard, true, null]))
        .code
    ).toBe("SUCCESS");
    expect(
      (
        await call("set_access_suspension", [
          technical,
          otherBoard,
          false,
          null,
        ])
      ).code
    ).toBe("SUCCESS");

    // Board reads the account directory; a manager reads nothing.
    expect(
      (
        await runtime`SELECT * FROM private.list_administrative_access(${board}::uuid)`
      ).length
    ).toBeGreaterThan(0);
    expect(
      await runtime`SELECT * FROM private.list_administrative_access(${f.managerId}::uuid)`
    ).toHaveLength(0);
    expect(
      await runtime`SELECT * FROM private.list_auth_directory(${f.managerId}::uuid)`
    ).toHaveLength(0);
    expect(
      (
        await call("record_auth_admin_action", [
          board,
          target,
          "user.invited",
          "invitation",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("record_auth_admin_action", [
          board,
          target,
          "user.password_admin_reset",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    const history =
      await runtime`SELECT action FROM private.list_user_audit(${board}::uuid, ${successor}::uuid)`;
    expect(history.map((h) => h.action)).toEqual(
      expect.arrayContaining([
        "access.suspended",
        "access.reactivated",
        "manager.assigned",
      ])
    );
  });

  it("keeps Board Administration away from suspended senior grants", async () => {
    const board = await senior("BOARD_ADMIN");
    const technical = await senior("TECHNICAL");
    const suspendedBoard = await senior("BOARD_ADMIN");
    const f = await createFixture(admin);
    expect(
      (
        await call("set_access_suspension", [
          technical,
          suspendedBoard,
          true,
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    // Neither a grant nor a replacement may overwrite the suspended Board row.
    expect(
      (
        await call("change_administrative_access", [
          board,
          suspendedBoard,
          "COMMITTEE_MANAGER",
          f.committeeId,
          "grant",
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("replace_committee_manager", [
          board,
          f.managerId,
          suspendedBoard,
          f.committeeId,
          null,
        ])
      ).code
    ).toBe("FORBIDDEN");
    const [row] =
      await admin`SELECT access_level, revocation_kind FROM public.administrative_access WHERE user_id = ${suspendedBoard}`;
    expect(row).toMatchObject({
      access_level: "BOARD_ADMIN",
      revocation_kind: "suspended",
    });
    expect(
      (
        await call("set_access_suspension", [
          technical,
          suspendedBoard,
          false,
          null,
        ])
      ).code
    ).toBe("SUCCESS");
  });

  it("never leaves the system without an active Technical owner", async () => {
    const codes: Record<string, string> = {};
    await expect(
      admin.begin(async (tx) => {
        await tx`UPDATE public.administrative_access SET revoked_at = now() WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL`;
        const [owner, second, board] = [
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ];
        await tx`INSERT INTO auth.users (id) VALUES (${owner}), (${second}), (${board})`;
        await tx`INSERT INTO public.administrative_access (user_id, access_level, granted_by)
          VALUES (${owner}, 'TECHNICAL', ${owner}), (${second}, 'TECHNICAL', ${owner}), (${board}, 'BOARD_ADMIN', ${owner})`;
        await tx`SET LOCAL ROLE app_runtime`;
        const run = async (actor: string, target: string) =>
          (
            await tx`SELECT private.set_access_suspension(${actor}::uuid, ${target}::uuid, true, NULL) AS r`
          )[0].r.code as string;
        codes.self = await run(owner, owner);
        codes.board = await run(board, owner);
        codes.second = await run(owner, second);
        // Only the owner is active now: the suspended account cannot act, Board may not.
        codes.fromSuspended = await run(second, owner);
        codes.fromBoard = await run(board, owner);
        await tx`RESET ROLE`;
        const [active] =
          await tx`SELECT count(*)::int AS n FROM public.administrative_access WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL`;
        codes.active = String(active.n);
        throw new Error("ROLLBACK_LAST_OWNER");
      })
    ).rejects.toThrow("ROLLBACK_LAST_OWNER");
    expect(codes).toEqual({
      self: "SELF_CHANGE",
      board: "FORBIDDEN",
      second: "SUCCESS",
      fromSuspended: "FORBIDDEN",
      fromBoard: "FORBIDDEN",
      active: "1",
    });
  });

  it("deletes an archived event permanently with its registrations, keeping non-personal audit history", async () => {
    const board = await senior("BOARD_ADMIN");
    const f = await createFixture(admin, { status: "published" });
    for (const n of [1, 2])
      expect(
        (
          await registration(
            runtime,
            f.eventId,
            `attendee${n}.${randomBytes(3).toString("hex")}@example.test`,
            "register",
            ip()
          )
        ).code
      ).toBe("SUCCESS");
    const cover = `event-covers/${randomUUID()}.jpg`;
    await admin`UPDATE public.events SET cover_image_key = ${cover} WHERE id = ${f.eventId}`;
    const before =
      await admin`SELECT count(*)::int AS n FROM private.uc02_audit WHERE event_id = ${f.eventId}`;

    const preview = await call("preview_event_deletion", [board, f.eventId]);
    expect(preview.preview).toMatchObject({
      registrations: 2,
      coverImage: true,
      blockers: ["EVENT_ACTIVE"],
    });
    expect(
      (
        await call("delete_event_permanently", [
          board,
          f.eventId,
          "UC-02 test event",
          "events",
        ])
      ).code
    ).toBe("BLOCKED");
    await admin`UPDATE public.events SET archived_at = now() WHERE id = ${f.eventId}`;
    expect(
      (
        await call("delete_event_permanently", [
          f.managerId,
          f.eventId,
          "UC-02 test event",
          "events",
        ])
      ).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("delete_event_permanently", [
          board,
          f.eventId,
          "wrong title",
          "events",
        ])
      ).code
    ).toBe("CONFIRMATION_MISMATCH");
    expect(
      await call("delete_event_permanently", [
        board,
        f.eventId,
        "UC-02 test event",
        "events",
      ])
    ).toMatchObject({ code: "SUCCESS", registrations: 2 });

    expect(
      await admin`SELECT 1 FROM public.events WHERE id = ${f.eventId}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM public.registrations WHERE event_id = ${f.eventId}`
    ).toHaveLength(0);
    const after =
      await admin`SELECT action FROM private.uc02_audit WHERE event_id = ${f.eventId} ORDER BY occurred_at`;
    expect(after).toHaveLength(before[0].n + 1);
    expect(after.at(-1)!.action).toBe("event.deleted");
    const [queued] =
      await admin`SELECT storage_bucket, reason FROM private.membership_storage_deletions WHERE storage_key = ${cover}`;
    expect(queued).toMatchObject({
      storage_bucket: "events",
      reason: "record_deleted",
    });
  });

  it("blocks event deletion while certificates exist", async () => {
    const board = await senior("BOARD_ADMIN");
    const f = await createFixture(admin, { status: "published" });
    await registration(
      runtime,
      f.eventId,
      `cert.${randomBytes(3).toString("hex")}@example.test`,
      "register",
      ip()
    );
    const [reg] =
      await admin`SELECT id FROM public.registrations WHERE event_id = ${f.eventId}`;
    await admin`INSERT INTO public.certificates (registration_id, certificate_url) VALUES (${reg.id}, 'https://example.test/certificate')`;
    await admin`UPDATE public.events SET archived_at = now() WHERE id = ${f.eventId}`;
    expect(
      await call("delete_event_permanently", [
        board,
        f.eventId,
        "UC-02 test event",
        "events",
      ])
    ).toMatchObject({ code: "BLOCKED", blockers: ["CERTIFICATES_EXIST"] });
    expect(
      await admin`SELECT 1 FROM public.events WHERE id = ${f.eventId}`
    ).toHaveLength(1);
  });

  it("deletes an unpublished project with its history and queued images", async () => {
    const technical = await senior("TECHNICAL");
    const m = await member();
    const affairs = await committeeBySlug("society-affairs");
    const content = { title: { en: "Synthetic deletion project", ar: "" } };
    const [p] =
      await admin`INSERT INTO private.projects (member_id, committee_id, content, status, published_revision, published_content)
      VALUES (${m.id}, ${affairs}, ${admin.json(content)}, 'approved', 1, ${admin.json(content)}) RETURNING id`;
    const image = `project-images/${randomUUID()}.png`;
    await admin`INSERT INTO private.project_media (project_id, object_key) VALUES (${p.id}, ${image})`;
    await admin`INSERT INTO private.project_history (project_id, actor_id, revision, action) VALUES (${p.id}, ${m.id}, 1, 'created')`;

    expect(
      (
        await call("delete_project_permanently", [
          technical,
          p.id,
          "Synthetic deletion project",
          "projects",
        ])
      ).blockers
    ).toEqual(["PROJECT_PUBLISHED"]);
    await admin`UPDATE private.projects SET published_revision = NULL, published_content = NULL WHERE id = ${p.id}`;
    expect(
      (
        await call("delete_project_permanently", [
          technical,
          p.id,
          "Synthetic",
          "projects",
        ])
      ).code
    ).toBe("CONFIRMATION_MISMATCH");
    expect(
      (
        await call("delete_project_permanently", [
          technical,
          p.id,
          "Synthetic deletion project",
          "projects",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      await admin`SELECT 1 FROM private.projects WHERE id = ${p.id}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM private.project_history WHERE project_id = ${p.id}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM private.membership_storage_deletions WHERE storage_key = ${image}`
    ).toHaveLength(1);
    const [entry] =
      await admin`SELECT changes FROM private.uc02_audit WHERE action = 'project.deleted' AND changes->>'projectId' = ${p.id}`;
    expect(entry.changes).toMatchObject({
      title: "Synthetic deletion project",
      media: 1,
    });
    // The author's membership is untouched.
    expect(
      await admin`SELECT 1 FROM public.members WHERE id = ${m.id}`
    ).toHaveLength(1);
  });

  it("deletes a membership record: data removed, registrations anonymized, account kept", async () => {
    const board = await senior("BOARD_ADMIN");
    const m = await member({ application: true });
    const f = await createFixture(admin, { status: "published" });
    const guest = await registration(
      runtime,
      f.eventId,
      m.email,
      "register",
      ip()
    );
    expect(guest.code).toBe("SUCCESS");
    const card = `membership-id-cards/${randomUUID()}.png`;
    await admin`INSERT INTO private.membership_documents (application_id, media_type, byte_size, sha256, storage_bucket, storage_key)
      VALUES (${m.applicationId}, 'image/png', 10, ${"a".repeat(64)}, 'identity', ${card})`;
    const photo = `member-photos/${randomUUID()}.jpg`;
    await admin`UPDATE public.members SET photo_key = ${photo} WHERE id = ${m.id}`;
    await admin`INSERT INTO private.committee_members (committee_id, member_id) VALUES (${f.committeeId}, ${m.id})`;
    await admin`INSERT INTO private.member_change_requests (member_id, field, requested_value) VALUES (${m.id}, 'full_name', 'Other Name')`;

    const preview = (
      await call("preview_member_deletion", [board, m.id, "membership"])
    ).preview;
    expect(preview).toMatchObject({
      registrations: 1,
      applications: 1,
      storedIdCards: 1,
      committees: 1,
      changeRequests: 1,
      photo: true,
      blockers: [],
    });
    expect(
      (await call("preview_member_deletion", [board, m.id, "account"])).code
    ).toBe("FORBIDDEN");
    expect(
      (
        await call("delete_member_record", [
          board,
          m.id,
          "someone@squ.edu.om",
          "photos",
        ])
      ).code
    ).toBe("CONFIRMATION_MISMATCH");
    expect(
      await call("delete_member_record", [
        board,
        m.id,
        m.email.toUpperCase(),
        "photos",
      ])
    ).toMatchObject({
      code: "SUCCESS",
      registrationsAnonymized: 1,
      applicationsDeleted: 1,
      rosterRemoved: 1,
      changeRequestsDeleted: 1,
      photoQueued: true,
    });
    expect(
      await admin`SELECT 1 FROM public.members WHERE id = ${m.id}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM private.membership_applications WHERE id = ${m.applicationId}`
    ).toHaveLength(0);
    const [reg] =
      await admin`SELECT attendee_name, attendee_email, member_id, attendee_phone FROM public.registrations WHERE id = ${guest.registrationId!}`;
    expect(reg).toMatchObject({
      attendee_name: "Deleted member",
      member_id: null,
      attendee_phone: null,
    });
    expect(reg.attendee_email).toMatch(
      /^deleted-[0-9a-f-]{36}@erased\.invalid$/
    );
    const queued =
      await admin`SELECT storage_key, reason FROM private.membership_storage_deletions WHERE storage_key IN (${card}, ${photo}) ORDER BY reason`;
    expect(queued.map((q) => q.reason)).toEqual([
      "document_removed",
      "record_deleted",
    ]);
    // The sign-in account remains.
    expect(
      await admin`SELECT 1 FROM auth.users WHERE id = ${m.id}`
    ).toHaveLength(1);
  });

  it("blocks deleting a member who still has projects, and anyone deleting themselves", async () => {
    const board = await senior("BOARD_ADMIN");
    const m = await member();
    const affairs = await committeeBySlug("society-affairs");
    await admin`INSERT INTO private.projects (member_id, committee_id, content) VALUES (${m.id}, ${affairs}, '{}'::jsonb)`;
    expect(
      await call("delete_member_record", [board, m.id, m.email, "photos"])
    ).toMatchObject({ code: "BLOCKED", blockers: ["MEMBER_HAS_PROJECTS"] });
    const self = await member();
    await admin`INSERT INTO public.administrative_access (user_id, access_level, granted_by) VALUES (${self.id}, 'BOARD_ADMIN', ${self.id})`;
    expect(
      (
        await call("delete_member_record", [
          self.id,
          self.id,
          self.email,
          "photos",
        ])
      ).code
    ).toBe("SELF_CHANGE");
  });

  it("erases an account completely: data, grant row and identifying audit references", async () => {
    const technical = await senior("TECHNICAL");
    const board = await senior("BOARD_ADMIN");
    const f = await createFixture(admin);
    const m = await member({ application: true });
    // The member acted (a profile edit) and was the subject of access changes with notes.
    expect(
      (
        await call("update_own_profile", [
          m.id,
          "+96891234567",
          3,
          "civil",
          "{data}",
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("change_administrative_access", [
          technical,
          m.id,
          "COMMITTEE_MANAGER",
          f.committeeId,
          "grant",
          "personal note",
        ])
      ).code
    ).toBe("SUCCESS");

    expect(
      (await call("erase_account", [board, m.id, m.email, "photos"])).code
    ).toBe("FORBIDDEN");
    expect(
      await call("erase_account", [technical, m.id, m.email, "photos"])
    ).toMatchObject({ code: "BLOCKED", blockers: ["ACTIVE_ACCESS"] });
    expect(
      (
        await call("change_administrative_access", [
          technical,
          m.id,
          "COMMITTEE_MANAGER",
          f.committeeId,
          "revoke",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (await call("erase_account", [technical, technical, "x", "photos"])).code
    ).toBe("SELF_CHANGE");
    const erased = await call("erase_account", [
      technical,
      m.id,
      m.email,
      "photos",
    ]);
    expect(erased.code).toBe("SUCCESS");

    expect(
      await admin`SELECT 1 FROM public.members WHERE id = ${m.id}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM public.administrative_access WHERE user_id = ${m.id}`
    ).toHaveLength(0);
    expect(
      await admin`SELECT 1 FROM private.uc02_audit WHERE actor_user_id = ${m.id}`
    ).toHaveLength(0);
    const pseudonymous =
      await admin`SELECT actor_kind, changes FROM private.uc02_audit WHERE action = 'member.profile_updated' AND actor_kind = 'erased' AND occurred_at > now() - interval '1 minute'`;
    expect(pseudonymous.length).toBeGreaterThan(0);
    const subject =
      await admin`SELECT changes FROM private.uc02_audit WHERE action IN ('manager.assigned', 'manager.revoked') AND committee_id = ${f.committeeId} AND actor_user_id = ${technical}`;
    expect(subject.length).toBe(2);
    for (const row of subject) {
      expect(row.changes.userId).toBeNull();
      expect(row.changes).not.toHaveProperty("note");
    }
    // Auth still has the identity, so the erasure stays pending until the Admin API removes it.
    expect(
      (await call("complete_account_erasure", [technical, erased.erasureId]))
        .code
    ).toBe("AUTH_ACCOUNT_REMAINS");
    expect(
      (
        await runtime`SELECT private.list_account_erasures(${technical}::uuid) AS r`
      )[0].r.erasures
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: erased.erasureId, userId: m.id }),
      ])
    );
    // Nothing references the identity any more, so Auth can delete it.
    await admin`DELETE FROM auth.users WHERE id = ${m.id}`;
    expect(
      (await call("complete_account_erasure", [technical, erased.erasureId]))
        .code
    ).toBe("SUCCESS");
    const [done] =
      await admin`SELECT count(*)::int AS n FROM private.uc02_audit WHERE action = 'account.erased' AND changes->>'erasureId' = ${erased.erasureId}`;
    expect(done.n).toBe(1);
  });

  it("keeps an account that anchors decisions about other people", async () => {
    const technical = await senior("TECHNICAL");
    const granter = await senior("TECHNICAL");
    const f = await createFixture(admin);
    expect(
      (
        await call("change_administrative_access", [
          granter,
          await user(),
          "COMMITTEE_MANAGER",
          f.committeeId,
          "grant",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call("change_technical_access", [
          technical,
          granter,
          "revoke",
          null,
        ])
      ).code
    ).toBe("SUCCESS");
    const [{ email }] =
      await admin`SELECT email FROM auth.users WHERE id = ${granter}`;
    expect(
      await call("erase_account", [technical, granter, email, "photos"])
    ).toMatchObject({
      code: "BLOCKED",
      blockers: ["ACCOUNTABILITY_RECORDS"],
    });
  });

  it("allows only erasure-shaped audit updates, never deletion", async () => {
    const technical = await senior("TECHNICAL");
    const [row] =
      await admin`INSERT INTO private.uc02_audit (actor_kind, actor_user_id, action, changes)
      VALUES ('authenticated', ${technical}, 'user.invited', ${admin.json({ userId: technical, detail: "invitation" })}) RETURNING id`;
    const asOwner = async (statement: string) =>
      admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE uc02_routine_owner`;
        await tx.unsafe(statement);
      });
    await expect(
      asOwner(
        `UPDATE private.uc02_audit SET action = 'user.created' WHERE id = '${row.id}'`
      )
    ).rejects.toThrow();
    await expect(
      asOwner(
        `UPDATE private.uc02_audit SET changes = '{"userId":"${technical}","detail":"other"}' WHERE id = '${row.id}'`
      )
    ).rejects.toThrow(/append-only/);
    await expect(
      asOwner(`DELETE FROM private.uc02_audit WHERE id = '${row.id}'`)
    ).rejects.toThrow(/permission denied/);
    await asOwner(
      `UPDATE private.uc02_audit SET actor_user_id = NULL, actor_kind = 'erased', changes = '{"userId":null}' WHERE id = '${row.id}'`
    );
    const [after] =
      await admin`SELECT actor_kind, changes FROM private.uc02_audit WHERE id = ${row.id}`;
    expect(after).toMatchObject({
      actor_kind: "erased",
      changes: { userId: null },
    });
  });

  it("never claims a queued file something still references", async () => {
    const f = await createFixture(admin);
    const cover = `event-covers/${randomUUID()}.png`;
    await admin`UPDATE public.events SET cover_image_key = ${cover} WHERE id = ${f.eventId}`;
    await admin`INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason) VALUES ('events', ${cover}, 'record_deleted')`;
    const claimed =
      await runtime`SELECT object_key FROM private.claim_membership_storage_deletions(50)`;
    expect(claimed.map((c) => c.object_key)).not.toContain(cover);
    await admin`UPDATE public.events SET cover_image_key = NULL WHERE id = ${f.eventId}`;
    const later =
      await runtime`SELECT object_key FROM private.claim_membership_storage_deletions(50)`;
    expect(later.map((c) => c.object_key)).toContain(cover);
  });

  it("exposes only entry points to the runtime and nothing to browser roles", async () => {
    const [p] = await admin`SELECT
      has_function_privilege('app_runtime', 'private.purge_member_data(uuid,text)', 'EXECUTE') AS purge,
      has_function_privilege('app_runtime', 'private.senior_admin_level(uuid)', 'EXECUTE') AS level,
      has_function_privilege('authenticated', 'private.admin_overview(uuid)', 'EXECUTE') AS overview,
      has_function_privilege('anon', 'private.erase_account(uuid,uuid,text,text)', 'EXECUTE') AS erase,
      has_function_privilege('app_runtime', 'private.delete_member_record(uuid,uuid,text,text)', 'EXECUTE') AS remove,
      has_table_privilege('app_runtime', 'private.committee_members', 'SELECT') AS roster,
      has_table_privilege('authenticated', 'private.account_erasures', 'SELECT') AS erasures`;
    expect(p).toEqual({
      purge: false,
      level: false,
      overview: false,
      erase: false,
      remove: true,
      roster: false,
      erasures: false,
    });
    const board = await senior("BOARD_ADMIN");
    const overview = await call("admin_overview", [board]);
    expect(overview).toMatchObject({ code: "SUCCESS", level: "BOARD_ADMIN" });
    expect(Array.isArray(overview.recent)).toBe(true);
    const f = await createFixture(admin);
    expect((await call("admin_overview", [f.managerId])).code).toBe(
      "FORBIDDEN"
    );
  });
});
