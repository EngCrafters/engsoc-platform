import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, close, runtimeDb } from "./helpers";

/**
 * Migration 0026: ID cards as references to private Storage objects, exercised
 * as the restricted `app_runtime` login. No Storage is contacted here; these
 * tests prove the database side (limits, references, the deletion queue and
 * its safety rules). Every identity and key is synthetic.
 */

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const key = (ext = "png") => `membership-id-cards/${randomUUID()}.${ext}`;
type Result = { code: string; [key: string]: unknown };

describe("membership documents in Storage", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const people: Record<string, string> = {};
  let ipCounter = 0;
  let seq = 0;
  const RUN = 20_000 + Math.floor(Math.random() * 70_000);
  const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

  async function call(
    sql: Sql,
    fn: string,
    values: unknown[]
  ): Promise<Result> {
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await sql.unsafe(
      `SELECT private.${fn}(${placeholders}) AS result`,
      values as never[]
    );
    return rows[0].result as Result;
  }

  function applicant() {
    seq += 1;
    return {
      email: `st${RUN}${seq}@squ.edu.om`,
      universityId: String(RUN * 1000 + seq),
      ip: nextIp(),
    };
  }

  const begin = (a: { email: string; universityId: string; ip: string }) =>
    call(runtime, "begin_membership_submission", [
      a.email,
      a.universityId,
      a.ip,
    ]);

  function submitStored(
    a: { email: string; universityId: string; ip: string },
    overrides: Partial<{
      mediaType: string;
      storageKey: string;
      bucket: string;
    }> = {}
  ) {
    const mediaType = overrides.mediaType ?? "image/png";
    return call(runtime, "submit_stored_membership_application", [
      "Synthetic Applicant",
      a.email,
      a.universityId,
      2,
      "civil",
      ["cad"],
      "2026-10-v1",
      sha(randomUUID()),
      mediaType,
      sha("synthetic card"),
      1234,
      overrides.bucket ?? "v1",
      overrides.storageKey ?? key(),
      a.ip,
    ]);
  }

  async function storedApplication(storageKey = key()) {
    const a = applicant();
    expect((await begin(a)).code).toBe("SUCCESS");
    const result = await submitStored(a, { storageKey });
    expect(result.code).toBe("SUCCESS");
    return { ...a, id: result.applicationId as string, storageKey };
  }

  beforeAll(async () => {
    const committees = await admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM public.committees WHERE slug IN ('society-affairs', 'media')`;
    const committee = Object.fromEntries(committees.map((c) => [c.slug, c.id]));
    for (const name of ["societyAffairs", "media", "board"]) {
      people[name] = randomUUID();
      await admin`INSERT INTO auth.users (id, email)
        VALUES (${people[name]}, ${`${name.toLowerCase()}-${people[name].slice(0, 6)}@example.test`})`;
    }
    const grant = (user: string, level: string, committeeId: string | null) =>
      admin`INSERT INTO public.administrative_access (user_id, access_level, committee_id, granted_by)
            VALUES (${user}, ${level}::public.administrative_access_level, ${committeeId}, ${user})`;
    await grant(
      people.societyAffairs,
      "COMMITTEE_MANAGER",
      committee["society-affairs"]
    );
    await grant(people.media, "COMMITTEE_MANAGER", committee.media);
    await grant(people.board, "BOARD_ADMIN", null);
  });

  afterAll(async () => close(admin, runtime));

  it("refuses a duplicate or rate-limited applicant before anything is uploaded", async () => {
    const first = await storedApplication();
    const again = { ...applicant(), email: first.email };
    expect((await begin(again)).code).toBe("ALREADY_APPLIED");
    const sameId = { ...applicant(), universityId: first.universityId };
    expect((await begin(sameId)).code).toBe("ALREADY_APPLIED");

    const busy = applicant();
    const codes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      codes.push((await begin({ ...applicant(), ip: busy.ip })).code);
    }
    expect(codes).toEqual([...Array(5).fill("SUCCESS"), "RATE_LIMITED"]);
    expect((await begin({ ...busy, email: "x@gmail.com" })).code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("records the reference, not the bytes, only after a recent begin from the same address", async () => {
    const a = applicant();
    expect((await submitStored(a)).code).toBe("NOT_STARTED");
    const { id, storageKey } = await storedApplication();
    const [doc] = await admin`
      SELECT content, storage_bucket, storage_key, media_type, byte_size
      FROM private.membership_documents WHERE application_id = ${id}`;
    expect(doc).toEqual({
      content: null,
      storage_bucket: "v1",
      storage_key: storageKey,
      media_type: "image/png",
      byte_size: 1234,
    });
    const audit = await admin`
      SELECT action FROM private.uc02_audit WHERE changes ->> 'applicationId' = ${id}`;
    expect(audit.map((r) => r.action)).toEqual(["membership.submitted"]);
  });

  it("validates the reference: shape, extension matching the type, bucket name", async () => {
    for (const overrides of [
      { storageKey: "membership-id-cards/not-a-uuid.png" },
      { storageKey: `other-prefix/${randomUUID()}.png` },
      { storageKey: key("pdf") },
      { mediaType: "image/gif" },
      { bucket: "../public" },
    ]) {
      const a = applicant();
      await begin(a);
      expect(
        await submitStored(a, overrides),
        JSON.stringify(overrides)
      ).toEqual({
        code: "VALIDATION_ERROR",
        field: "idDocument",
      });
    }
  });

  it("enforces exactly one location for every document row", async () => {
    const { id } = await storedApplication();
    await expect(
      // Bytes of the recorded length, so only the location rule can object.
      admin`UPDATE private.membership_documents SET content = decode(repeat('00', 1234), 'hex')
            WHERE application_id = ${id}`
    ).rejects.toThrow(/membership_document_location/);
    await expect(
      admin`UPDATE private.membership_documents SET storage_key = NULL, storage_bucket = NULL
            WHERE application_id = ${id}`
    ).rejects.toThrow(/membership_document_location/);
  });

  it("gives the reference only to an authorized reviewer, and audits the view", async () => {
    const { id, storageKey } = await storedApplication();
    const read = (actor: string) =>
      runtime`SELECT * FROM private.get_membership_document(${actor}::uuid, ${id}::uuid)`;
    expect(await read(people.media)).toHaveLength(0);
    const [doc] = await read(people.societyAffairs);
    expect(doc).toMatchObject({
      media_type: "image/png",
      content: null,
      storage_bucket: "v1",
      storage_key: storageKey,
    });
    const views = await admin`
      SELECT actor_user_id FROM private.uc02_audit
      WHERE action = 'membership.document_viewed' AND changes ->> 'applicationId' = ${id}`;
    expect(views.map((v) => v.actor_user_id)).toEqual([people.societyAffairs]);
  });

  it("queues the object in the decision's transaction, and hands it out once", async () => {
    const { id, storageKey } = await storedApplication();
    const result = await call(runtime, "review_membership_application", [
      people.societyAffairs,
      id,
      1,
      "reject",
      "Synthetic: unreadable card",
    ]);
    expect(result.code).toBe("SUCCESS");
    const [queued] = await admin`
      SELECT reason, completed_at FROM private.membership_storage_deletions
      WHERE storage_key = ${storageKey}`;
    expect(queued).toEqual({ reason: "document_removed", completed_at: null });

    const claimed = await runtime<
      { deletion_id: string; bucket: string; object_key: string }[]
    >`SELECT * FROM private.claim_membership_storage_deletions(50)`;
    const mine = claimed.find((c) => c.object_key === storageKey);
    expect(mine?.bucket).toBe("v1");
    // Tried within the last minute: not handed out again yet.
    const again =
      await runtime`SELECT * FROM private.claim_membership_storage_deletions(50)`;
    expect(again.some((c) => c.object_key === storageKey)).toBe(false);

    expect(
      (
        await call(runtime, "complete_membership_storage_deletion", [
          mine!.deletion_id,
        ])
      ).code
    ).toBe("SUCCESS");
    expect(
      (
        await call(runtime, "complete_membership_storage_deletion", [
          mine!.deletion_id,
        ])
      ).code
    ).toBe("NOT_FOUND");
  });

  it("never queues or hands out an object a document still references", async () => {
    const { storageKey } = await storedApplication();
    expect(
      (
        await call(runtime, "queue_abandoned_membership_upload", [
          "v1",
          storageKey,
        ])
      ).code
    ).toBe("REFERENCED");
    // Even a queue entry that should not exist is skipped while referenced.
    await admin`INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason)
                VALUES ('v1', ${storageKey}, 'upload_abandoned')`;
    const claimed =
      await runtime`SELECT * FROM private.claim_membership_storage_deletions(50)`;
    expect(claimed.some((c) => c.object_key === storageKey)).toBe(false);

    const orphan = key("pdf");
    expect(
      (await call(runtime, "queue_abandoned_membership_upload", ["v1", orphan]))
        .code
    ).toBe("SUCCESS");
    const next =
      await runtime`SELECT * FROM private.claim_membership_storage_deletions(50)`;
    expect(next.some((c) => c.object_key === orphan)).toBe(true);
    expect(
      (
        await call(runtime, "queue_abandoned_membership_upload", [
          "v1",
          "../../etc/passwd",
        ])
      ).code
    ).toBe("VALIDATION_ERROR");
  });

  it("keeps the queue and the helper out of reach of every login role", async () => {
    await expect(
      runtime`SELECT count(*) FROM private.membership_storage_deletions`
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime`SELECT private.membership_invalid_field('a','b','c',1,'d','{}','e','f')`
    ).rejects.toThrow(/permission denied/);
  });
});
