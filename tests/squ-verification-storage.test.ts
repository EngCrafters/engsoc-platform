import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SQU student verification evidence in private Storage (ADR 0025, after ADR 0018's order):
// begin, upload under a random key, then record the reference. No network, no database.
vi.mock("server-only", () => ({}));
const routines = vi.hoisted(() => ({
  begin: vi.fn(),
  submit: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("../lib/verification/db", () => ({
  beginSquThroughRoutine: routines.begin,
  submitSquThroughRoutine: routines.submit,
  queueAbandonedSquThroughRoutine: routines.queue,
  ownSquThroughRoutine: vi.fn(),
  ownLeadershipThroughRoutine: vi.fn(),
  leadershipOptionsThroughRoutine: vi.fn(),
  requestLeadershipThroughRoutine: vi.fn(),
}));

import { DOCUMENT_KEY_PATTERN, STORAGE_ENV } from "../lib/membership/storage";
import { submitSquVerification } from "../lib/verification/member";

// A synthetic, non-image byte sequence with a PNG signature: never a real card.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const ACTOR = "11111111-1111-4111-8111-111111111111";
const evidence = {
  studentNumber: "20231234",
  document: { mediaType: "image/png" as const, bytes: PNG },
};
const SECRET = "local-test-secret-NEVER-SENT-0123456789";
const storageEnv = {
  SUPABASE_S3_ENDPOINT: "https://project.storage.supabase.co/storage/v1/s3",
  SUPABASE_S3_REGION: "ap-northeast-1",
  SUPABASE_S3_ACCESS_KEY_ID: "0123456789abcdef0123456789abcdef",
  SUPABASE_S3_SECRET_ACCESS_KEY: SECRET,
  SUPABASE_S3_MEMBERSHIP_BUCKET: "v1",
};

type Call = { method: string; url: string };
let calls: Call[];
let respond: (call: Call) => Response;

function useStorage(env: Record<string, string> = storageEnv) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

beforeEach(() => {
  for (const fn of Object.values(routines)) fn.mockReset();
  for (const name of STORAGE_ENV) vi.stubEnv(name, "");
  calls = [];
  respond = () => new Response(null, { status: 200 });
  vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit = {}) => {
    const call = { method: init.method ?? "GET", url: String(url) };
    calls.push(call);
    return respond(call);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  routines.begin.mockResolvedValue({ code: "SUCCESS" });
  routines.submit.mockResolvedValue({ code: "SUCCESS", requestId: "r-1" });
  routines.queue.mockResolvedValue({ code: "SUCCESS" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const keyOf = (call: Call) =>
  decodeURIComponent(new URL(call.url).pathname).replace(
    "/storage/v1/s3/v1/",
    ""
  );

describe("SQU verification evidence with private Storage", () => {
  it("keeps the bytes in PostgreSQL while no Storage variable is set", async () => {
    expect((await submitSquVerification(ACTOR, evidence)).code).toBe("SUCCESS");
    expect(routines.submit).toHaveBeenCalledWith(ACTOR, {
      studentNumber: "20231234",
      mediaType: "image/png",
      sha256: createHash("sha256").update(PNG).digest("hex"),
      byteSize: PNG.byteLength,
      content: Buffer.from(PNG),
      storageBucket: null,
      storageKey: null,
    });
    expect(calls).toEqual([]);
  });

  it("refuses to store anything when Storage is only partly configured", async () => {
    useStorage({ ...storageEnv, SUPABASE_S3_MEMBERSHIP_BUCKET: "" });
    expect(await submitSquVerification(ACTOR, evidence)).toEqual({
      code: "STORAGE_UNAVAILABLE",
    });
    expect(routines.begin).not.toHaveBeenCalled();
    expect(routines.submit).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("uploads nothing for a member the database refuses", async () => {
    useStorage();
    for (const code of [
      "ALREADY_PENDING",
      "ALREADY_VERIFIED",
      "RATE_LIMITED",
      "MEMBER_REQUIRED",
    ]) {
      routines.begin.mockResolvedValue({ code });
      expect((await submitSquVerification(ACTOR, evidence)).code).toBe(code);
    }
    expect(calls).toEqual([]);
    expect(routines.submit).not.toHaveBeenCalled();
  });

  it("stores the card under a random squ-verification key and records only the reference", async () => {
    useStorage();
    expect((await submitSquVerification(ACTOR, evidence)).code).toBe("SUCCESS");
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    const key = keyOf(calls[0]);
    expect(key).toMatch(DOCUMENT_KEY_PATTERN);
    expect(key.startsWith("squ-verification/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(key).not.toMatch(/20231234|1111/);
    expect(routines.submit.mock.calls[0][1]).toMatchObject({
      content: null,
      storageBucket: "v1",
      storageKey: key,
      byteSize: PNG.byteLength,
    });
  });

  it("reports a refused upload as unavailable and writes no request", async () => {
    useStorage();
    respond = () => new Response(null, { status: 403 });
    expect(await submitSquVerification(ACTOR, evidence)).toEqual({
      code: "STORAGE_UNAVAILABLE",
    });
    expect(routines.submit).not.toHaveBeenCalled();
    expect(routines.queue).not.toHaveBeenCalled();
  });

  it("queues a possibly-stored object when the upload breaks off", async () => {
    useStorage();
    respond = () => {
      throw new TypeError("socket hang up");
    };
    expect((await submitSquVerification(ACTOR, evidence)).code).toBe(
      "STORAGE_UNAVAILABLE"
    );
    expect(routines.submit).not.toHaveBeenCalled();
    expect(routines.queue).toHaveBeenCalledWith("v1", keyOf(calls[0]));
  });

  it("deletes the object when the request is refused after upload, or queues it when that fails", async () => {
    useStorage();
    routines.submit.mockResolvedValue({ code: "ALREADY_PENDING" });
    expect((await submitSquVerification(ACTOR, evidence)).code).toBe(
      "ALREADY_PENDING"
    );
    expect(calls.map((c) => c.method)).toEqual(["PUT", "DELETE"]);
    expect(keyOf(calls[1])).toBe(keyOf(calls[0]));
    expect(routines.queue).not.toHaveBeenCalled();

    calls = [];
    respond = (call) =>
      new Response(null, { status: call.method === "DELETE" ? 500 : 200 });
    await submitSquVerification(ACTOR, evidence);
    expect(routines.queue).toHaveBeenCalledWith("v1", keyOf(calls[0]));
  });

  it("never deletes directly when the database outcome is unknown", async () => {
    useStorage();
    routines.submit.mockRejectedValue(new Error("connection reset"));
    await expect(submitSquVerification(ACTOR, evidence)).rejects.toThrow(
      "connection reset"
    );
    // Only the queue, which refuses referenced objects, may remove it.
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(routines.queue).toHaveBeenCalledWith("v1", keyOf(calls[0]));
  });
});
