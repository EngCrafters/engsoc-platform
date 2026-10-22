import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const routines = vi.hoisted(() => ({
  begin: vi.fn(),
  submitStored: vi.fn(),
  submit: vi.fn(),
  queue: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../lib/membership/db", () => ({
  beginSubmissionThroughRoutine: routines.begin,
  submitStoredThroughRoutine: routines.submitStored,
  submitThroughRoutine: routines.submit,
  queueAbandonedUploadThroughRoutine: routines.queue,
  statusThroughRoutine: routines.status,
}));

import { DOCUMENT_KEY_PATTERN, STORAGE_ENV } from "../lib/membership/storage";
import { submitMembershipApplication } from "../lib/membership";

// A synthetic, non-image byte sequence with a PNG signature: never a real card.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const application = {
  fullName: "Synthetic Applicant",
  email: "s000001@squ.edu.om",
  universityId: "00000001",
  academicYear: 2,
  discipline: "civil" as const,
  interests: [],
  consentVersion: "2026-10-v1",
  document: { mediaType: "image/png" as const, bytes: PNG },
};
const IP = "203.0.113.7";
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
  routines.submitStored.mockResolvedValue({
    code: "SUCCESS",
    applicationId: "33333333-3333-4333-8333-333333333333",
  });
  routines.queue.mockResolvedValue("SUCCESS");
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

describe("membership submission with private Storage", () => {
  it("keeps the PostgreSQL path while no Storage variable is set", async () => {
    routines.submit.mockResolvedValue({
      code: "SUCCESS",
      applicationId: "33333333-3333-4333-8333-333333333333",
    });
    const result = await submitMembershipApplication(application, IP);
    expect(result.ok).toBe(true);
    expect(routines.submit).toHaveBeenCalledTimes(1);
    expect(routines.begin).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("refuses to store anything when Storage is only partly configured", async () => {
    useStorage({ ...storageEnv, SUPABASE_S3_MEMBERSHIP_BUCKET: "" });
    expect(await submitMembershipApplication(application, IP)).toEqual({
      ok: false,
      error: "server_error",
    });
    expect(routines.submit).not.toHaveBeenCalled();
    expect(routines.begin).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("uploads nothing for a refused applicant", async () => {
    useStorage();
    for (const [code, error] of [
      ["RATE_LIMITED", "rate_limited"],
      ["ALREADY_APPLIED", "already_applied"],
      ["ALREADY_MEMBER", "already_member"],
    ]) {
      routines.begin.mockResolvedValue({ code });
      expect(await submitMembershipApplication(application, IP)).toEqual({
        ok: false,
        error,
      });
    }
    expect(calls).toEqual([]);
    expect(routines.submitStored).not.toHaveBeenCalled();
  });

  it("stores the card under a random key and records only the reference", async () => {
    useStorage();
    const result = await submitMembershipApplication(application, IP);
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    const key = keyOf(calls[0]);
    expect(key).toMatch(DOCUMENT_KEY_PATTERN);
    expect(key.endsWith(".png")).toBe(true);
    expect(key).not.toMatch(/s000001|00000001|Synthetic/);
    const stored = routines.submitStored.mock.calls[0][0];
    expect(stored).toMatchObject({
      storageBucket: "v1",
      storageKey: key,
      byteSize: PNG.byteLength,
      mediaType: "image/png",
      sha256: createHash("sha256").update(PNG).digest("hex"),
      ipAddress: IP,
    });
    expect(routines.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "s000001@squ.edu.om",
        universityId: "00000001",
        ipAddress: IP,
      })
    );
  });

  it("reports a refused upload as unavailable and writes no application", async () => {
    useStorage();
    respond = () => new Response(null, { status: 403 });
    expect(await submitMembershipApplication(application, IP)).toEqual({
      ok: false,
      error: "server_error",
    });
    expect(routines.submitStored).not.toHaveBeenCalled();
    expect(routines.queue).not.toHaveBeenCalled();
  });

  it("queues a possibly-stored object when the upload breaks off", async () => {
    useStorage();
    respond = () => {
      throw new TypeError("socket hang up");
    };
    expect((await submitMembershipApplication(application, IP)).ok).toBe(false);
    expect(routines.submitStored).not.toHaveBeenCalled();
    expect(routines.queue).toHaveBeenCalledWith("v1", keyOf(calls[0]));
  });

  it("deletes the object when the application is refused after upload", async () => {
    useStorage();
    routines.submitStored.mockResolvedValue({ code: "ALREADY_APPLIED" });
    expect(await submitMembershipApplication(application, IP)).toEqual({
      ok: false,
      error: "already_applied",
    });
    expect(calls.map((c) => c.method)).toEqual(["PUT", "DELETE"]);
    expect(keyOf(calls[1])).toBe(keyOf(calls[0]));
    expect(routines.queue).not.toHaveBeenCalled();
  });

  it("queues the object when that deletion fails", async () => {
    useStorage();
    routines.submitStored.mockResolvedValue({ code: "ALREADY_MEMBER" });
    respond = (call) =>
      new Response(null, { status: call.method === "DELETE" ? 500 : 200 });
    await submitMembershipApplication(application, IP);
    expect(routines.queue).toHaveBeenCalledWith("v1", keyOf(calls[0]));
  });

  it("never deletes directly when the database outcome is unknown", async () => {
    useStorage();
    routines.submitStored.mockRejectedValue(new Error("connection reset"));
    expect(await submitMembershipApplication(application, IP)).toEqual({
      ok: false,
      error: "server_error",
    });
    // Only the queue, which refuses referenced objects, may remove it.
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(routines.queue).toHaveBeenCalledWith("v1", keyOf(calls[0]));
  });
});
