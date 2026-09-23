import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadModule() {
  return import("../lib/auth/local-review");
}

describe("local review mode guard", () => {
  it("is inactive with no env var set", async () => {
    delete process.env.UC02_LOCAL_REVIEW_DATABASE_URL;
    const { isLocalReviewModeActive } = await loadModule();
    expect(isLocalReviewModeActive()).toBe(false);
  });

  it("is inactive when VERCEL is set, even with the var set and a local URL", async () => {
    vi.stubEnv("VERCEL", "1");
    process.env.UC02_LOCAL_REVIEW_DATABASE_URL =
      "postgres://postgres:postgres@127.0.0.1:55440/uc02_test";
    const { isLocalReviewModeActive } = await loadModule();
    expect(isLocalReviewModeActive()).toBe(false);
  });

  it("is inactive for a non-local host", async () => {
    process.env.UC02_LOCAL_REVIEW_DATABASE_URL =
      "postgres://user:pass@db.example.com:5432/uc02_test";
    const { isLocalReviewModeActive } = await loadModule();
    expect(isLocalReviewModeActive()).toBe(false);
  });

  it("is inactive for an unparseable URL", async () => {
    process.env.UC02_LOCAL_REVIEW_DATABASE_URL = "not a url";
    const { isLocalReviewModeActive } = await loadModule();
    expect(isLocalReviewModeActive()).toBe(false);
  });

  it("is active for a local host with NODE_ENV=production, matching the real local review server (next start)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.UC02_LOCAL_REVIEW_DATABASE_URL =
      "postgres://postgres:postgres@127.0.0.1:55440/uc02_test";
    const { isLocalReviewModeActive } = await loadModule();
    expect(isLocalReviewModeActive()).toBe(true);
  });

  it("getLocalReviewCommittees returns nothing when inactive, without connecting", async () => {
    delete process.env.UC02_LOCAL_REVIEW_DATABASE_URL;
    const { getLocalReviewCommittees } = await loadModule();
    await expect(
      getLocalReviewCommittees("11111111-1111-4111-8111-111111111111")
    ).resolves.toEqual([]);
  });
});
