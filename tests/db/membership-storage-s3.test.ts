import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, close } from "./helpers";

/**
 * The whole Storage path (ADR 0018) against a local S3-compatible server that
 * enforces signatures: Core's real submission, document route, review routine
 * and deletion worker, with the restricted runtime login. Skipped unless
 * MEMBERSHIP_S3_TEST_ENDPOINT, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY point at
 * a local stand-in with a bucket named `v1`; never at real Storage. Every
 * applicant, card and key is synthetic.
 */
const endpoint = process.env.MEMBERSHIP_S3_TEST_ENDPOINT;

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({
  current: { kind: "anonymous" } as object,
}));
vi.mock("../../lib/auth/manager", () => ({
  getManagerContext: async () => session.current,
}));

describe.skipIf(!endpoint)("membership ID cards in a local S3 stand-in", () => {
  const admin = adminDb();
  const people: Record<string, string> = {};
  // A synthetic file with a PNG signature; Core never decodes it.
  const CARD = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`synthetic test card ${randomUUID()}`),
  ]);
  let core: {
    submit: typeof import("../../lib/membership").submitMembershipApplication;
    route: typeof import("../../app/admin/(protected)/membership/[id]/document/route").GET;
    processDeletions: typeof import("../../lib/membership/server").processMembershipStorageDeletions;
    storage: typeof import("../../lib/membership/storage");
  };

  const manager = (id: string) => ({
    kind: "manager",
    userId: id,
    email: null,
    accessLevel: "COMMITTEE_MANAGER",
    committees: [],
  });
  const viewDocument = (applicationId: string) =>
    core.route(new Request("http://localhost/doc"), {
      params: Promise.resolve({ id: applicationId }),
    });
  const config = () => {
    const mode = core.storage.documentStorageMode();
    if (mode.mode !== "storage") throw new Error("storage not configured");
    return mode.config;
  };
  const application = (n: number) => ({
    fullName: "Synthetic Applicant",
    email: `s3e2e.${n}@squ.edu.om`,
    universityId: String(n),
    academicYear: 3,
    discipline: "civil" as const,
    interests: [],
    consentVersion: "2026-10-v1",
    document: { mediaType: "image/png" as const, bytes: new Uint8Array(CARD) },
  });
  const RUN = 30_000_000 + Math.floor(Math.random() * 60_000_000);

  beforeAll(async () => {
    process.env.APP_RUNTIME_DATABASE_URL =
      process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL;
    process.env.SUPABASE_S3_ENDPOINT = endpoint;
    process.env.SUPABASE_S3_REGION = "ap-northeast-1";
    process.env.SUPABASE_S3_ACCESS_KEY_ID =
      process.env.MEMBERSHIP_S3_TEST_ACCESS_KEY_ID;
    process.env.SUPABASE_S3_SECRET_ACCESS_KEY =
      process.env.MEMBERSHIP_S3_TEST_SECRET_ACCESS_KEY;
    process.env.SUPABASE_S3_MEMBERSHIP_BUCKET = "v1";
    core = {
      submit: (await import("../../lib/membership"))
        .submitMembershipApplication,
      route: (
        await import("../../app/admin/(protected)/membership/[id]/document/route")
      ).GET,
      processDeletions: (await import("../../lib/membership/server"))
        .processMembershipStorageDeletions,
      storage: await import("../../lib/membership/storage"),
    };

    const committees = await admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM public.committees WHERE slug IN ('society-affairs', 'media')`;
    const committee = Object.fromEntries(committees.map((c) => [c.slug, c.id]));
    for (const name of ["societyAffairs", "media", "board"]) {
      people[name] = randomUUID();
      await admin`INSERT INTO auth.users (id, email)
        VALUES (${people[name]}, ${`s3-${name.toLowerCase()}-${people[name].slice(0, 6)}@example.test`})`;
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

  afterAll(async () => close(admin));

  it("stores, serves to reviewers only, checks integrity, and deletes after the decision", async () => {
    const result = await core.submit(application(RUN), "192.0.2.10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [doc] = await admin<
      {
        content: Buffer | null;
        storage_bucket: string;
        storage_key: string;
        sha256: string;
      }[]
    >`SELECT content, storage_bucket, storage_key, sha256 FROM private.membership_documents
      WHERE application_id = ${result.applicationId}`;
    expect(doc.content).toBeNull();
    expect(doc.storage_bucket).toBe("v1");
    expect(doc.sha256).toBe(createHash("sha256").update(CARD).digest("hex"));

    // The object is really there, and only a correct signature reaches it.
    const stored = await core.storage.getDocumentObject(
      config(),
      doc.storage_key,
      4_194_304
    );
    expect(stored.ok && Buffer.from(stored.bytes).equals(CARD)).toBe(true);
    const forged = await core.storage.getDocumentObject(
      { ...config(), secretAccessKey: "wrong-secret-for-signature-check" },
      doc.storage_key,
      4_194_304
    );
    expect(forged.ok).toBe(false);

    // Society Affairs manager: the bytes, privately, through Core.
    session.current = manager(people.societyAffairs);
    const view = await viewDocument(result.applicationId);
    expect(view.status).toBe(200);
    expect(Buffer.from(await view.arrayBuffer()).equals(CARD)).toBe(true);
    expect(view.headers.get("cache-control")).toContain("no-store");
    expect(view.headers.get("content-type")).toBe("image/png");

    // Another committee's manager, and nobody signed in: nothing.
    session.current = manager(people.media);
    expect((await viewDocument(result.applicationId)).status).toBe(403);
    session.current = { kind: "anonymous" };
    expect((await viewDocument(result.applicationId)).status).toBe(401);

    // A changed object is refused, not served.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const tampered = Buffer.concat([CARD, Buffer.from("x")]);
    await core.storage.putDocumentObject(
      config(),
      doc.storage_key,
      tampered,
      "image/png",
      createHash("sha256").update(tampered).digest("hex")
    );
    session.current = manager(people.societyAffairs);
    expect((await viewDocument(result.applicationId)).status).toBe(503);
    expect(log).toHaveBeenCalledWith("membership_storage_integrity_failed", {
      applicationId: result.applicationId,
    });
    log.mockRestore();

    // Approval stays disabled while the policy is unconfirmed; the card is kept.
    const [{ approve }] = await admin<{ approve: { code: string } }[]>`
      SELECT private.review_membership_application(${people.board}::uuid,
        ${result.applicationId}::uuid, 1, 'approve', NULL) AS approve`;
    expect(approve.code).toBe("POLICY_NOT_CONFIRMED");

    // Rejection removes the reference at once and the object via the queue.
    const [{ reject }] = await admin<{ reject: { code: string } }[]>`
      SELECT private.review_membership_application(${people.societyAffairs}::uuid,
        ${result.applicationId}::uuid, 1, 'reject', 'Synthetic test') AS reject`;
    expect(reject.code).toBe("SUCCESS");
    expect((await viewDocument(result.applicationId)).status).toBe(404);
    const processed = await core.processDeletions(50);
    expect(processed.deleted).toBeGreaterThanOrEqual(1);
    const gone = await core.storage.getDocumentObject(
      config(),
      doc.storage_key,
      4_194_304
    );
    expect(gone).toEqual({ ok: false, missing: true });
    const [queue] =
      await admin`SELECT completed_at FROM private.membership_storage_deletions
      WHERE storage_key = ${doc.storage_key}`;
    expect(queue.completed_at).not.toBeNull();
  });

  it("writes no application when the upload is refused", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.SUPABASE_S3_MEMBERSHIP_BUCKET = "no-such-bucket";
    try {
      const failed = await core.submit(application(RUN + 1), "192.0.2.11");
      expect(failed).toEqual({ ok: false, error: "server_error" });
      const rows = await admin`SELECT 1 FROM private.membership_applications
        WHERE email = ${application(RUN + 1).email}`;
      expect(rows).toHaveLength(0);
    } finally {
      process.env.SUPABASE_S3_MEMBERSHIP_BUCKET = "v1";
      log.mockRestore();
    }
  });
});
