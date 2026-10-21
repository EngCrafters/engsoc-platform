import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectContent } from "./fixtures/project-content";

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  publicProjects: vi.fn(),
  readProjects: vi.fn(),
  writeProject: vi.fn(),
  mediaChange: vi.fn(),
  mediaKey: vi.fn(),
  boundedBytes: vi.fn(),
  uploadProjectImage: vi.fn(),
  removeProjectImage: vi.fn(),
  readProjectImage: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: state.getUser } }),
}));
vi.mock("@/lib/projects/server", () => ({
  publicProjects: state.publicProjects,
  readProjects: state.readProjects,
  writeProject: state.writeProject,
  mediaChange: state.mediaChange,
  mediaKey: state.mediaKey,
}));
vi.mock("@/lib/projects/storage", () => ({
  boundedBytes: state.boundedBytes,
  uploadProjectImage: state.uploadProjectImage,
  removeProjectImage: state.removeProjectImage,
  readProjectImage: state.readProjectImage,
}));
const api = await import("@/lib/projects/api");
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";
function request(
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  search = ""
) {
  return new Request(`https://api.essqu.com/v1/me/projects${search}`, {
    method,
    headers: {
      origin: "https://essqu.com",
      authorization: `Bearer ${JWT}`,
      "content-type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function imageRequest(type = "image/png") {
  return new Request(`https://api.essqu.com/v1/me/projects/${PROJECT}/media`, {
    method: "POST",
    headers: {
      origin: "https://essqu.com",
      authorization: `Bearer ${JWT}`,
      "content-type": type,
    },
    body: new Uint8Array([1, 2, 3]),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CORE_API_ALLOWED_ORIGINS", "https://essqu.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic");
  state.getUser.mockResolvedValue({
    data: { user: { id: USER } },
    error: null,
  });
  state.publicProjects.mockResolvedValue({ code: "SUCCESS", projects: [] });
  state.readProjects.mockResolvedValue({
    code: "SUCCESS",
    projects: [
      { id: PROJECT, status: "draft", revision: 1, publishedRevision: null },
    ],
    total: 1,
  });
  state.writeProject.mockResolvedValue({
    code: "SUCCESS",
    id: PROJECT,
    revision: 1,
  });
  state.mediaChange.mockResolvedValue({ code: "SUCCESS", id: MEDIA });
  state.mediaKey.mockResolvedValue(null);
  state.boundedBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
  state.uploadProjectImage.mockResolvedValue(`project-images/${MEDIA}.png`);
  state.removeProjectImage.mockResolvedValue(undefined);
});

describe("member projects API authentication, DTO and media boundaries", () => {
  it("uses only the verified Auth identity, exact allowed origin and private uncached responses", async () => {
    const response = await api.memberProjects(
      request("GET", undefined, { "x-user-id": PROJECT })
    );
    expect(response.status).toBe(200);
    expect(state.readProjects).toHaveBeenCalledWith(
      USER,
      null,
      false,
      "all",
      "",
      0
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://essqu.com"
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(
      (
        await api.memberProjects(
          request("GET", undefined, {
            authorization: "Bearer essq_live_not_a_session",
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await api.memberProjects(
          request("GET", undefined, { origin: "https://evil.test" })
        )
      ).status
    ).toBe(403);
    expect(state.readProjects).toHaveBeenCalledTimes(1);
    state.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    expect((await api.memberProjects(request())).status).toBe(401);
  });

  it("creates only design-shaped content and rejects privilege, author and storage fields", async () => {
    const content = projectContent();
    expect(
      (
        await api.memberProjects(
          request("POST", { operation: "create", content })
        )
      ).status
    ).toBe(201);
    expect(state.writeProject).toHaveBeenCalledWith(
      USER,
      null,
      null,
      "create",
      content
    );
    for (const body of [
      null,
      [],
      {},
      { operation: "create", content, memberId: PROJECT },
      { operation: "create", content, status: "approved" },
      { operation: "publish", content },
      {
        operation: "create",
        content: { ...content, object_key: "private/secret" },
      },
    ])
      expect((await api.memberProjects(request("POST", body))).status).toBe(
        422
      );
    expect(state.writeProject).toHaveBeenCalledTimes(1);
  });

  it("permits only own save/submit intents and validates revisions, bodies, IDs and pagination before DB", async () => {
    const content = projectContent();
    expect(
      (
        await api.memberProjects(
          request("PATCH", { operation: "save", revision: 2, content }),
          PROJECT
        )
      ).status
    ).toBe(200);
    expect(state.writeProject).toHaveBeenLastCalledWith(
      USER,
      PROJECT,
      2,
      "save",
      content
    );
    expect(
      (
        await api.memberProjects(
          request("POST", { operation: "submit", revision: 2 }),
          PROJECT
        )
      ).status
    ).toBe(200);
    expect(state.writeProject).toHaveBeenLastCalledWith(
      USER,
      PROJECT,
      2,
      "submit",
      null
    );
    for (const body of [
      { operation: "submit", revision: 0 },
      { operation: "submit", revision: 1.2 },
      { operation: "submit", revision: "2" },
      { operation: "submit", revision: 2, content },
      { operation: "approve", revision: 2 },
      { operation: "publish", revision: 2 },
      { operation: "start_review", revision: 2 },
    ])
      expect(
        (await api.memberProjects(request("POST", body), PROJECT)).status
      ).toBe(422);
    expect((await api.memberProjects(request("GET"), "invalid")).status).toBe(
      404
    );
    for (const value of ["-1", "10001", "1.5", "NaN", "Infinity"])
      expect(
        (
          await api.memberProjects(
            request("GET", undefined, {}, `?offset=${value}`)
          )
        ).status
      ).toBe(422);
    expect(state.readProjects).not.toHaveBeenCalled();
    expect(state.writeProject).toHaveBeenCalledTimes(2);
    expect(
      (
        await api.memberProjects(
          request(
            "POST",
            { operation: "create", content },
            { "content-type": "text/plain" }
          )
        )
      ).status
    ).toBe(415);
    expect(
      (
        await api.memberProjects(
          request(
            "POST",
            { operation: "create", content },
            { "content-length": "65537" }
          )
        )
      ).status
    ).toBe(413);
  });

  it("preserves eligibility/conflict errors and fails closed on infrastructure or Auth outages", async () => {
    for (const [code, status] of [
      ["MEMBER_REQUIRED", 403],
      ["STALE_REVISION", 409],
      ["INVALID_TRANSITION", 409],
      ["NOT_FOUND", 404],
      ["UNAVAILABLE", 503],
    ] as const) {
      state.readProjects.mockResolvedValue({ code });
      const response = await api.memberProjects(request());
      expect(response.status).toBe(status);
      expect((await response.json()).errors[0].code).toBe(code);
    }
    state.readProjects.mockRejectedValue(
      new Error("postgres credential hidden")
    );
    const response = await api.memberProjects(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("credential hidden");
    state.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503 },
    });
    expect((await api.memberProjects(request())).status).toBe(503);
  });

  it("reads public snapshots without credentials, returns 404 for private/missing IDs and never calls member routines", async () => {
    const anonymous = new Request("https://api.essqu.com/v1/projects");
    expect((await api.publicRead(anonymous)).status).toBe(200);
    expect(state.publicProjects).toHaveBeenCalledWith(null, 0);
    expect((await api.publicRead(anonymous, PROJECT)).status).toBe(404);
    expect((await api.publicRead(anonymous, "bad-id")).status).toBe(404);
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.readProjects).not.toHaveBeenCalled();
    expect(state.writeProject).not.toHaveBeenCalled();
  });

  it("never reads storage until the DB authorizes a media key and keeps private image responses safe", async () => {
    const anonymous = new Request(
      `https://api.essqu.com/v1/projects/${PROJECT}/media/${MEDIA}`
    );
    expect((await api.projectImage(anonymous, PROJECT, MEDIA)).status).toBe(
      404
    );
    expect(state.mediaKey).toHaveBeenCalledWith(null, PROJECT, MEDIA);
    expect(state.readProjectImage).not.toHaveBeenCalled();
    state.mediaKey.mockResolvedValue(`project-images/${MEDIA}.png`);
    state.readProjectImage.mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      type: "image/png",
    });
    const image = await api.projectImage(request(), PROJECT, MEDIA);
    expect(image.status).toBe(200);
    expect(state.mediaKey).toHaveBeenLastCalledWith(USER, PROJECT, MEDIA);
    expect(image.headers.get("cache-control")).toBe("private, no-store");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("referrer-policy")).toBe("no-referrer");
    state.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    expect((await api.projectImage(request(), PROJECT, MEDIA)).status).toBe(
      401
    );
    expect(state.readProjectImage).toHaveBeenCalledTimes(1);
  });

  it("validates uploads, cleans known failures and retains objects after uncertain commits", async () => {
    expect(
      (await api.memberMedia(imageRequest("image/svg+xml"), PROJECT)).status
    ).toBe(422);
    expect(state.uploadProjectImage).not.toHaveBeenCalled();
    state.boundedBytes.mockResolvedValue(null);
    expect((await api.memberMedia(imageRequest(), PROJECT)).status).toBe(413);
    state.boundedBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
    state.uploadProjectImage.mockRejectedValueOnce(new Error("INVALID_IMAGE"));
    expect((await api.memberMedia(imageRequest(), PROJECT)).status).toBe(422);
    expect(state.mediaChange).not.toHaveBeenCalled();
    state.mediaChange.mockResolvedValueOnce({ code: "MEDIA_LIMIT" });
    expect((await api.memberMedia(imageRequest(), PROJECT)).status).toBe(409);
    expect(state.removeProjectImage).toHaveBeenCalledWith(
      `project-images/${MEDIA}.png`
    );
    state.removeProjectImage.mockClear();
    state.mediaChange.mockRejectedValueOnce(
      new Error("uncertain database commit")
    );
    expect((await api.memberMedia(imageRequest(), PROJECT)).status).toBe(503);
    expect(state.removeProjectImage).not.toHaveBeenCalled();
    expect((await api.memberMedia(imageRequest(), PROJECT)).status).toBe(201);
    expect(state.mediaChange).toHaveBeenLastCalledWith(
      USER,
      PROJECT,
      "add",
      null,
      `project-images/${MEDIA}.png`
    );
  });

  it("denies review-stage uploads and removes storage only after an owner-authorized removal", async () => {
    for (const status of ["submitted", "under_review", "approved"]) {
      state.readProjects.mockResolvedValue({
        code: "SUCCESS",
        projects: [
          { id: PROJECT, status, revision: 2, publishedRevision: null },
        ],
      });
      expect((await api.memberMedia(imageRequest(), PROJECT)).status).toBe(409);
    }
    expect(state.uploadProjectImage).not.toHaveBeenCalled();
    state.mediaChange.mockResolvedValueOnce({ code: "NOT_FOUND" });
    expect(
      (await api.memberMedia(request("DELETE"), PROJECT, MEDIA)).status
    ).toBe(404);
    expect(state.removeProjectImage).not.toHaveBeenCalled();
    state.mediaChange.mockResolvedValueOnce({
      code: "SUCCESS",
      key: `project-images/${MEDIA}.png`,
    });
    expect(
      (await api.memberMedia(request("DELETE"), PROJECT, MEDIA)).status
    ).toBe(200);
    expect(state.mediaChange).toHaveBeenLastCalledWith(
      USER,
      PROJECT,
      "remove",
      MEDIA
    );
    expect(state.removeProjectImage).toHaveBeenCalledWith(
      `project-images/${MEDIA}.png`
    );
  });

  it("allows bearer JSON/image/deletion preflight only for the configured website", () => {
    const response = api.projectPreflight(request("OPTIONS"));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "DELETE"
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Authorization"
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(
      api
        .projectPreflight(
          request("OPTIONS", undefined, { origin: "https://evil.test" })
        )
        .headers.get("access-control-allow-origin")
    ).toBeNull();
  });
});
