import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DOCUMENT_KEY_PATTERN,
  deleteDocumentObject,
  documentStorageMode,
  getDocumentObject,
  newDocumentKey,
  putDocumentObject,
  signRequest,
  type StorageConfig,
} from "../lib/membership/storage";

// Synthetic credentials only. The secret below must never appear in a header
// value, a log line or an error.
const SECRET = "local-test-secret-NEVER-SENT-0123456789";
const config: StorageConfig = {
  endpoint: new URL("https://project.storage.supabase.co/storage/v1/s3"),
  region: "ap-northeast-1",
  bucket: "v1",
  accessKeyId: "0123456789abcdef0123456789abcdef",
  secretAccessKey: SECRET,
};
const env = {
  SUPABASE_S3_ENDPOINT: "https://project.storage.supabase.co/storage/v1/s3",
  SUPABASE_S3_REGION: "ap-northeast-1",
  SUPABASE_S3_ACCESS_KEY_ID: "0123456789abcdef0123456789abcdef",
  SUPABASE_S3_SECRET_ACCESS_KEY: SECRET,
  SUPABASE_S3_MEMBERSHIP_BUCKET: "v1",
};
const sha = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const signatureOf = (headers: Record<string, string>) =>
  /Signature=([0-9a-f]{64})$/.exec(headers.authorization)?.[1];

describe("SigV4 signing", () => {
  // AWS's published examples ("Signature Calculations for the Authorization
  // Header: Transferring Payload in a Single Chunk"), with AWS's example keys.
  const aws = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    now: new Date("2013-05-24T00:00:00Z"),
  };

  it("reproduces AWS's GET Object example signature", () => {
    const headers = signRequest({
      ...aws,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { Range: "bytes=0-9" },
      payloadSha256: sha(""),
    });
    expect(signatureOf(headers)).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
    expect(headers.authorization).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request"
    );
    expect(headers.authorization).toContain(
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date"
    );
  });

  it("reproduces AWS's PUT Object example signature, including path encoding", () => {
    const payload = "Welcome to Amazon S3.";
    expect(sha(payload)).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
    );
    const headers = signRequest({
      ...aws,
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: {
        Date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadSha256: sha(payload),
    });
    expect(signatureOf(headers)).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
    );
  });

  it("never puts the secret in a header and leaves Host to fetch", () => {
    const headers = signRequest({
      method: "GET",
      url: new URL("https://example.test/x"),
      payloadSha256: sha(""),
      region: "ap-northeast-1",
      accessKeyId: config.accessKeyId,
      secretAccessKey: SECRET,
    });
    expect(JSON.stringify(headers)).not.toContain(SECRET);
    expect(headers).not.toHaveProperty("host");
  });
});

describe("storage configuration", () => {
  it("keeps documents in PostgreSQL until every Storage variable is set", () => {
    expect(documentStorageMode({})).toEqual({ mode: "database" });
    const ready = documentStorageMode(env);
    expect(ready.mode).toBe("storage");
    if (ready.mode === "storage") {
      expect(ready.config.bucket).toBe("v1");
      expect(ready.config.endpoint.pathname).toBe("/storage/v1/s3");
    }
  });

  it("refuses a partial or unsafe configuration, naming variables but never values", () => {
    const partial = documentStorageMode({
      ...env,
      SUPABASE_S3_SECRET_ACCESS_KEY: "",
    });
    expect(partial).toEqual({
      mode: "misconfigured",
      problems: ["SUPABASE_S3_SECRET_ACCESS_KEY"],
    });
    for (const endpoint of [
      "http://project.storage.supabase.co/storage/v1/s3",
      "https://key:secret@project.storage.supabase.co/storage/v1/s3",
      "https://project.storage.supabase.co/storage/v1/s3?x=1",
      "not a url",
    ]) {
      const result = documentStorageMode({
        ...env,
        SUPABASE_S3_ENDPOINT: endpoint,
      });
      expect(result, endpoint).toEqual({
        mode: "misconfigured",
        problems: ["SUPABASE_S3_ENDPOINT"],
      });
    }
    expect(
      JSON.stringify(
        documentStorageMode({ ...env, SUPABASE_S3_REGION: "Bad Region" })
      )
    ).not.toContain(SECRET);
  });

  it("allows plain http only for a local stand-in, and never once deployed", () => {
    const local = { ...env, SUPABASE_S3_ENDPOINT: "http://127.0.0.1:4569" };
    expect(documentStorageMode(local).mode).toBe("storage");
    expect(documentStorageMode({ ...local, VERCEL: "1" }).mode).toBe(
      "misconfigured"
    );
  });
});

describe("object keys", () => {
  it("are random, typed by the file's real type, and carry nothing personal", () => {
    const jpg = newDocumentKey("image/jpeg");
    const pdf = newDocumentKey("application/pdf");
    expect(jpg).toMatch(DOCUMENT_KEY_PATTERN);
    expect(jpg.endsWith(".jpg")).toBe(true);
    expect(pdf.endsWith(".pdf")).toBe(true);
    expect(newDocumentKey("image/jpeg")).not.toBe(jpg);
  });
});

describe("object operations", () => {
  const key = "membership-id-cards/3f8c2c1e-9a7b-4c3d-8e21-0a1b2c3d4e5f.jpg";
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  function fakeFetch(respond: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: URL | string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return respond();
    }) as typeof fetch;
    return { impl, calls };
  }

  it("uploads path-style to the private bucket with a signed payload hash", async () => {
    const { impl, calls } = fakeFetch(
      () => new Response(null, { status: 200 })
    );
    await expect(
      putDocumentObject(config, key, bytes, "image/jpeg", sha(bytes), impl)
    ).resolves.toEqual({ ok: true });
    expect(calls[0].url).toBe(
      `https://project.storage.supabase.co/storage/v1/s3/v1/${key}`
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].init.method).toBe("PUT");
    expect(headers["content-type"]).toBe("image/jpeg");
    expect(headers["x-amz-content-sha256"]).toBe(sha(bytes));
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=0123456789abcdef0123456789abcdef\/\d{8}\/ap-northeast-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );
    expect(JSON.stringify(calls)).not.toContain(SECRET);
    expect(calls[0].url).not.toMatch(/public|token=|X-Amz-Signature/i);
  });

  it("separates a refused upload from one that may have been stored", async () => {
    await expect(
      putDocumentObject(
        config,
        key,
        bytes,
        "image/jpeg",
        sha(bytes),
        fakeFetch(() => new Response("denied", { status: 403 })).impl
      )
    ).resolves.toEqual({ ok: false, uncertain: false });
    await expect(
      putDocumentObject(
        config,
        key,
        bytes,
        "image/jpeg",
        sha(bytes),
        fakeFetch(() => new Response(null, { status: 503 })).impl
      )
    ).resolves.toEqual({ ok: false, uncertain: true });
    await expect(
      putDocumentObject(
        config,
        key,
        bytes,
        "image/jpeg",
        sha(bytes),
        fakeFetch(() => {
          throw new TypeError("network");
        }).impl
      )
    ).resolves.toEqual({ ok: false, uncertain: true });
    // Logs say what failed, never where or with what.
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      new RegExp(`${SECRET}|${key}|supabase\\.co`)
    );
  });

  it("reads within the size limit and reports a missing object", async () => {
    const ok = await getDocumentObject(
      config,
      key,
      1024,
      fakeFetch(() => new Response(bytes, { status: 200 })).impl
    );
    expect(ok.ok && Array.from(ok.bytes)).toEqual(Array.from(bytes));
    await expect(
      getDocumentObject(
        config,
        key,
        4,
        fakeFetch(
          () =>
            new Response(bytes, {
              status: 200,
              headers: { "content-length": String(bytes.byteLength) },
            })
        ).impl
      )
    ).resolves.toEqual({ ok: false, missing: false });
    await expect(
      getDocumentObject(
        config,
        key,
        1024,
        fakeFetch(() => new Response(null, { status: 404 })).impl
      )
    ).resolves.toEqual({ ok: false, missing: true });
  });

  it("treats an already-deleted object as deleted, and a failure as not", async () => {
    for (const status of [200, 204, 404]) {
      await expect(
        deleteDocumentObject(
          config,
          key,
          fakeFetch(() => new Response(null, { status })).impl
        )
      ).resolves.toBe(true);
    }
    await expect(
      deleteDocumentObject(
        config,
        key,
        fakeFetch(() => new Response(null, { status: 500 })).impl
      )
    ).resolves.toBe(false);
  });

  it("refuses to address anything outside the queued key space, without failing the run", async () => {
    const fetchSpy = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(
      deleteDocumentObject(config, "../other-bucket/secret.pdf", fetchSpy.impl)
    ).resolves.toBe(false);
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it("deletes the other kinds of queued file (0032)", async () => {
    for (const queued of [
      "event-covers/11111111-1111-4111-8111-111111111111.png",
      "project-images/11111111-1111-4111-8111-111111111111.jpg",
      "member-photos/11111111-1111-4111-8111-111111111111.jpg",
    ]) {
      await expect(
        deleteDocumentObject(
          config,
          queued,
          fakeFetch(() => new Response(null, { status: 204 })).impl
        )
      ).resolves.toBe(true);
    }
  });
});
