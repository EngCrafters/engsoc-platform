import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, close } from "./helpers";

/**
 * The whole Storage path for SQU verification evidence (ADRs 0018 and 0025)
 * against a local S3-compatible server that enforces signatures: Core's real
 * member submission, the reviewer document route, the review routine, the
 * retention cleanup and the deletion worker, with the restricted runtime
 * login. Skipped unless MEMBERSHIP_S3_TEST_ENDPOINT, _ACCESS_KEY_ID and
 * _SECRET_ACCESS_KEY point at a local stand-in with a bucket named `v1`; never
 * at real Storage. Every member, card and key is synthetic.
 */
const endpoint = process.env.MEMBERSHIP_S3_TEST_ENDPOINT;

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({
  current: { kind: "anonymous" } as object,
}));
vi.mock("../../lib/auth/manager", () => ({
  getManagerContext: async () => session.current,
}));

describe.skipIf(!endpoint)(
  "SQU verification evidence in a local S3 stand-in",
  () => {
    const admin = adminDb();
    const people: Record<string, string> = {};
    // A synthetic file with a PNG signature; Core never decodes it.
    const CARD = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`synthetic test card ${randomUUID()}`),
    ]);
    let core: {
      submit: typeof import("../../lib/verification/member").submitSquVerification;
      route: typeof import("../../app/admin/(protected)/membership/verifications/[id]/document/route").GET;
      purge: typeof import("../../lib/verification/review").purgeExpiredVerificationDocuments;
      storage: typeof import("../../lib/membership/storage");
    };

    const manager = (id: string) => ({
      kind: "manager",
      userId: id,
      email: null,
      accessLevel: "COMMITTEE_MANAGER",
      committees: [],
    });
    const viewDocument = (requestId: string) =>
      core.route(new Request("http://localhost/doc"), {
        params: Promise.resolve({ id: requestId }),
      });
    const config = () => {
      const mode = core.storage.documentStorageMode();
      if (mode.mode !== "storage") throw new Error("storage not configured");
      return mode.config;
    };
    const evidence = () => ({
      studentNumber: String(
        30_000_000 + Math.floor(Math.random() * 60_000_000)
      ),
      document: {
        mediaType: "image/png" as const,
        bytes: new Uint8Array(CARD),
      },
    });

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
        submit: (await import("../../lib/verification/member"))
          .submitSquVerification,
        route: (
          await import("../../app/admin/(protected)/membership/verifications/[id]/document/route")
        ).GET,
        purge: (await import("../../lib/verification/review"))
          .purgeExpiredVerificationDocuments,
        storage: await import("../../lib/membership/storage"),
      };

      const committees = await admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM public.committees WHERE slug IN ('society-affairs', 'media')`;
      const committee = Object.fromEntries(
        committees.map((c) => [c.slug, c.id])
      );
      for (const name of ["societyAffairs", "media", "technical", "member"]) {
        people[name] = randomUUID();
        await admin`INSERT INTO auth.users (id, email, email_confirmed_at)
        VALUES (${people[name]}, ${`s3-${name.toLowerCase()}-${people[name].slice(0, 6)}@example.test`}, now())`;
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
      await grant(people.technical, "TECHNICAL", null);
      await admin`INSERT INTO public.members (id, full_name, email, major, category)
      VALUES (${people.member}, 'Synthetic Member', ${`s3-member-${people.member.slice(0, 6)}@example.test`},
        'civil', 'university_student')`;
    });

    afterAll(async () => {
      await admin`UPDATE private.verification_settings SET document_retention_days = NULL`;
      await close(admin);
    });

    it("stores, serves to reviewers only, checks integrity, and removes evidence only under a retention period", async () => {
      const result = await core.submit(people.member, evidence());
      expect(result.code).toBe("SUCCESS");
      const requestId = result.requestId as string;
      const [doc] = await admin<
        {
          content: Buffer | null;
          storage_bucket: string;
          storage_key: string;
          sha256: string;
        }[]
      >`SELECT content, storage_bucket, storage_key, sha256 FROM private.squ_verification_documents
      WHERE request_id = ${requestId}`;
      expect(doc.content).toBeNull();
      expect(doc.storage_bucket).toBe("v1");
      expect(doc.storage_key.startsWith("squ-verification/")).toBe(true);
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
      const view = await viewDocument(requestId);
      expect(view.status).toBe(200);
      expect(Buffer.from(await view.arrayBuffer()).equals(CARD)).toBe(true);
      expect(view.headers.get("cache-control")).toContain("no-store");
      expect(view.headers.get("content-type")).toBe("image/png");

      // Another committee's manager, and nobody signed in: nothing.
      session.current = manager(people.media);
      expect((await viewDocument(requestId)).status).toBe(403);
      session.current = { kind: "anonymous" };
      expect((await viewDocument(requestId)).status).toBe(401);

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
      expect((await viewDocument(requestId)).status).toBe(503);
      expect(log).toHaveBeenCalledWith(
        "verification_storage_integrity_failed",
        {
          request: requestId,
        }
      );
      log.mockRestore();

      // A decision keeps the evidence; only a configured retention period removes it.
      const [{ decided }] = await admin<{ decided: { code: string } }[]>`
      SELECT private.decide_squ_verification(${people.societyAffairs}::uuid, ${requestId}::uuid,
        1, 'reject', 'Synthetic test', NULL) AS decided`;
      expect(decided.code).toBe("SUCCESS");
      expect(await core.purge(people.societyAffairs)).toBe(0);
      await admin`UPDATE private.squ_verification_requests SET decided_at = now() - interval '40 days'
      WHERE id = ${requestId}`;
      await admin`UPDATE private.verification_settings SET document_retention_days = 30`;
      expect(await core.purge(people.societyAffairs)).toBeGreaterThanOrEqual(1);
      expect((await viewDocument(requestId)).status).toBe(404);
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

    it("writes no request when the upload is refused", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.SUPABASE_S3_MEMBERSHIP_BUCKET = "no-such-bucket";
      try {
        const failed = await core.submit(people.member, evidence());
        expect(failed).toEqual({ code: "STORAGE_UNAVAILABLE" });
        const rows = await admin`SELECT 1 FROM private.squ_verification_requests
        WHERE member_id = ${people.member} AND status = 'pending'`;
        expect(rows).toHaveLength(0);
      } finally {
        process.env.SUPABASE_S3_MEMBERSHIP_BUCKET = "v1";
        log.mockRestore();
      }
    });
  }
);
