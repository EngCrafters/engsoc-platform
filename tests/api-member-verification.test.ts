import { beforeEach, describe, expect, it, vi } from "vitest";

// The member side of ADR 0025 over HTTP: SQU verification and committee leadership (two
// independent endpoints), SQU evidence, leadership options and requests, and the category-aware profile edit. The database is
// mocked; tests/db/development-cycle-2.test.ts covers the routines themselves.
const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  squState: vi.fn(),
  leadership: vi.fn(),
  submitSqu: vi.fn(),
  options: vi.fn(),
  request: vi.fn(),
  updateV2: vi.fn(),
  membershipOptions: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: state.getUser } }),
}));
vi.mock("@/lib/verification/member", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/verification/member")>()),
  ownSquVerification: state.squState,
  ownLeadership: state.leadership,
  submitSquVerification: state.submitSqu,
  leadershipOptions: state.options,
  requestLeadership: state.request,
}));
vi.mock("@/lib/members/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/members/profile")>()),
  updateOwnProfileV2: state.updateV2,
}));
vi.mock("@/lib/membership/db", () => ({
  optionsThroughRoutine: state.membershipOptions,
}));
const verification = await import("../app/v1/me/verification/route");
const squ = await import("../app/v1/me/verification/squ/route");
const leadership = await import("../app/v1/me/leadership/route");
const leadershipOptions = await import("../app/v1/me/leadership/options/route");
const leadershipRequests =
  await import("../app/v1/me/leadership/requests/route");
const profile = await import("../app/v1/me/profile/route");
const { resetMembershipOptionsCache } = await import("@/lib/membership");

const USER = "11111111-1111-4111-8111-111111111111";
const COMMITTEE = "22222222-2222-4222-8222-222222222222";
const TEAM = "33333333-3333-4333-8333-333333333333";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

function request(
  url: string,
  method: string,
  body?: BodyInit | object,
  headers: Record<string, string> = {}
) {
  const raw = body instanceof FormData || typeof body === "string";
  return new Request(`https://api.essqu.com/v1${url}`, {
    method,
    headers: {
      origin: "https://essqu.com",
      authorization: `Bearer ${JWT}`,
      ...(body && !(body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: raw ? (body as BodyInit) : JSON.stringify(body) }
      : {}),
  });
}
function evidence(
  number: string | null = "20231234",
  file: Blob | null = new Blob([PNG])
) {
  const form = new FormData();
  if (number !== null) form.set("studentNumber", number);
  if (file) form.set("document", file, "card.png");
  return form;
}
const json = async (response: Response) => response.json();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resetMembershipOptionsCache();
  vi.stubEnv("CORE_API_ALLOWED_ORIGINS", "https://essqu.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic");
  state.getUser.mockResolvedValue({
    data: { user: { id: USER } },
    error: null,
  });
  state.squState.mockResolvedValue({
    code: "SUCCESS",
    status: "not_verified",
    canSubmit: true,
  });
  state.leadership.mockResolvedValue({
    code: "SUCCESS",
    appointments: [],
    requests: [],
    limits: { requestsPer30Days: 5, recentRequests: 0 },
    dashboardAccess: false,
  });
  state.submitSqu.mockResolvedValue({ code: "SUCCESS", requestId: "r-1" });
  state.options.mockResolvedValue({
    code: "SUCCESS",
    committees: [],
    positions: [],
  });
  state.request.mockResolvedValue({ code: "SUCCESS", requestId: "q-1" });
  state.updateV2.mockResolvedValue({ code: "SUCCESS", category: "academic" });
  state.membershipOptions.mockResolvedValue({
    code: "SUCCESS",
    categories: [
      {
        id: "university_student",
        label: { en: "Student", ar: "طالب" },
        institution: "required",
        academicYear: true,
      },
      {
        id: "academic",
        label: { en: "Academic", ar: "أكاديمي" },
        institution: "none",
        academicYear: false,
      },
    ],
    institutions: [
      {
        id: "squ",
        name: { en: "SQU", ar: "جامعة السلطان قابوس" },
        country: "OM",
      },
    ],
    consentVersion: "2026-11-v2",
  });
});

describe("GET /v1/me/verification", () => {
  it("answers only for the identity Supabase verified, never a member named in the request", async () => {
    const response = await verification.GET(
      request(`/me/verification?member=${COMMITTEE}`, "GET")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.squState).toHaveBeenCalledWith(USER);
    expect(state.leadership).not.toHaveBeenCalled();
    const body = await json(response);
    expect(body.data.status).toBe("not_verified");
    expect(body.data).not.toHaveProperty("appointments");
  });

  it("requires a session and a member record", async () => {
    expect(
      (
        await verification.GET(
          request("/me/verification", "GET", undefined, { authorization: "" })
        )
      ).status
    ).toBe(401);
    state.squState.mockResolvedValue({ code: "MEMBER_REQUIRED" });
    expect(
      (await verification.GET(request("/me/verification", "GET"))).status
    ).toBe(403);
  });

  it("refuses a foreign origin", async () => {
    const response = await verification.GET(
      request("/me/verification", "GET", undefined, {
        origin: "https://evil.example",
      })
    );
    expect(response.status).toBe(403);
    expect(state.squState).not.toHaveBeenCalled();
  });
});

describe("GET /v1/me/leadership", () => {
  it("answers for the verified identity with leadership only", async () => {
    const response = await leadership.GET(
      request(`/me/leadership?member=${COMMITTEE}`, "GET")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.leadership).toHaveBeenCalledWith(USER);
    expect(state.squState).not.toHaveBeenCalled();
    const body = await json(response);
    expect(body.data.appointments).toEqual([]);
    expect(body.data.dashboardAccess).toBe(false);
    expect(body.data).not.toHaveProperty("status");
  });

  it("fails on its own: a leadership outage leaves SQU verification answering", async () => {
    state.leadership.mockRejectedValue(
      Object.assign(new Error("routine missing"), { code: "42883" })
    );
    const failed = await leadership.GET(request("/me/leadership", "GET"));
    expect(failed.status).toBe(503);
    expect((await json(failed)).code).toBe("service-unavailable");
    const squ = await verification.GET(request("/me/verification", "GET"));
    expect(squ.status).toBe(200);
  });

  it("requires a session and a member record", async () => {
    expect(
      (
        await leadership.GET(
          request("/me/leadership", "GET", undefined, { authorization: "" })
        )
      ).status
    ).toBe(401);
    state.leadership.mockResolvedValue({ code: "MEMBER_REQUIRED" });
    expect(
      (await leadership.GET(request("/me/leadership", "GET"))).status
    ).toBe(403);
  });
});

describe("POST /v1/me/verification/squ", () => {
  it("submits the student number and the file's real type for the signed-in member", async () => {
    const response = await squ.POST(
      request("/me/verification/squ", "POST", evidence())
    );
    expect(response.status).toBe(201);
    expect(state.submitSqu).toHaveBeenCalledWith(USER, {
      studentNumber: "20231234",
      document: { mediaType: "image/png", bytes: expect.any(Uint8Array) },
    });
  });

  it("names invalid fields, including a disguised file and an extra field", async () => {
    const svg = new Blob(["<svg/>"], { type: "image/png" });
    const form = evidence("12ab", svg);
    form.set("memberId", COMMITTEE);
    const response = await squ.POST(
      request("/me/verification/squ", "POST", form)
    );
    expect(response.status).toBe(422);
    expect((await json(response)).errors).toEqual([
      { field: "memberId", code: "unexpected-field" },
      { field: "studentNumber", code: "invalid" },
      { field: "document", code: "unsupported-type" },
    ]);
    expect(state.submitSqu).not.toHaveBeenCalled();
    const missing = await squ.POST(
      request("/me/verification/squ", "POST", evidence(null, null))
    );
    expect((await json(missing)).errors).toEqual([
      { field: "studentNumber", code: "required" },
      { field: "document", code: "required" },
    ]);
  });

  it("refuses an oversized body before reading it", async () => {
    const response = await squ.POST(
      request("/me/verification/squ", "POST", evidence(), {
        "content-length": "5000000",
      })
    );
    expect(response.status).toBe(413);
  });

  it.each([
    ["ALREADY_PENDING", 409],
    ["ALREADY_VERIFIED", 409],
    ["RATE_LIMITED", 429],
    ["MEMBER_REQUIRED", 403],
    ["STORAGE_UNAVAILABLE", 503],
  ])("maps %s to %i", async (code, status) => {
    state.submitSqu.mockResolvedValue({ code });
    const response = await squ.POST(
      request("/me/verification/squ", "POST", evidence())
    );
    expect(response.status).toBe(status);
    if (status !== 503)
      expect((await json(response)).errors).toEqual([{ field: "squ", code }]);
  });
});

describe("leadership requests", () => {
  const ask = (body: object) =>
    leadershipRequests.POST(request("/me/leadership/requests", "POST", body));

  it("serves the options for the signed-in member", async () => {
    const response = await leadershipOptions.GET(
      request("/me/leadership/options", "GET")
    );
    expect(response.status).toBe(200);
    expect(state.options).toHaveBeenCalledWith(USER);
  });

  it("sends the chosen hierarchy for the database to check again", async () => {
    const response = await ask({
      committeeId: COMMITTEE,
      teamId: TEAM,
      position: "chief",
    });
    expect(response.status).toBe(201);
    expect(state.request).toHaveBeenCalledWith(USER, COMMITTEE, TEAM, "chief");
  });

  it("sends committee-level leadership with no team, whether the team is absent or null (ADR 0026)", async () => {
    for (const body of [
      { committeeId: COMMITTEE, position: "assistant_chief" },
      { committeeId: COMMITTEE, teamId: null, position: "assistant_chief" },
    ]) {
      state.request.mockClear();
      expect((await ask(body)).status).toBe(201);
      expect(state.request).toHaveBeenCalledWith(
        USER,
        COMMITTEE,
        null,
        "assistant_chief"
      );
    }
  });

  it("refuses malformed requests and any attempt to name a member or a status", async () => {
    for (const [body, field] of [
      [
        {
          committeeId: COMMITTEE,
          teamId: TEAM,
          position: "chief",
          memberId: USER,
        },
        "leadership",
      ],
      [{ committeeId: "x", teamId: TEAM, position: "chief" }, "committee"],
      [{ committeeId: COMMITTEE, teamId: 7, position: "chief" }, "team"],
      [{ committeeId: COMMITTEE, teamId: "", position: "chief" }, "team"],
      [{ teamId: TEAM, position: "chief" }, "committee"],
      [{ committeeId: COMMITTEE, teamId: TEAM, position: "CEO!" }, "position"],
    ] as const) {
      const response = await ask(body);
      expect(response.status).toBe(422);
      expect((await json(response)).errors[0].field).toBe(field);
    }
    expect(state.request).not.toHaveBeenCalled();
  });

  it.each([
    ["HIERARCHY_MISMATCH", 422],
    ["TEAM_INACTIVE", 409],
    ["COMMITTEE_ARCHIVED", 409],
    ["ALREADY_PENDING", 409],
    ["ALREADY_APPOINTED", 409],
    ["RATE_LIMITED", 429],
    ["NOT_FOUND", 404],
    ["REQUESTS_CLOSED", 409],
  ])("maps %s to %i", async (code, status) => {
    state.request.mockResolvedValue({ code, field: "team" });
    const response = await ask({
      committeeId: COMMITTEE,
      teamId: TEAM,
      position: "chief",
    });
    expect(response.status).toBe(status);
  });
});

describe("PATCH /v1/me/profile with a category (ADR 0025)", () => {
  const patch = (body: object) =>
    profile.PATCH(request("/me/profile", "PATCH", body));
  const base = {
    phone: null,
    category: "academic",
    institution: "squ",
    institutionName: "Leftover",
    academicYear: 4,
    discipline: "civil",
    interests: ["cad"],
  };

  it("drops details the category does not collect", async () => {
    const response = await patch(base);
    expect(response.status).toBe(200);
    expect(state.updateV2).toHaveBeenCalledWith(USER, {
      phone: null,
      category: "academic",
      institutionId: null,
      institutionName: null,
      academicYear: null,
      discipline: "civil",
      interests: ["cad"],
    });
  });

  it("asks a student for a listed or typed institution and a year", async () => {
    const student = { ...base, category: "university_student" };
    expect(
      (await json(await patch({ ...student, institution: "" }))).errors[0].field
    ).toBe("institution");
    expect(
      (await json(await patch({ ...student, institution: "mit" }))).errors[0]
        .field
    ).toBe("institution");
    expect(
      (
        await json(
          await patch({
            ...student,
            institution: "other",
            institutionName: "X",
          })
        )
      ).errors[0].field
    ).toBe("institutionName");
    expect(
      (await json(await patch({ ...student, academicYear: 9 }))).errors[0].field
    ).toBe("academicYear");
    expect(
      (await json(await patch({ ...base, category: "astronaut" }))).errors[0]
        .field
    ).toBe("category");
    expect(state.updateV2).not.toHaveBeenCalled();
    expect(
      (
        await patch({
          ...student,
          institution: "other",
          institutionName: "Imperial College London",
        })
      ).status
    ).toBe(200);
    expect(state.updateV2).toHaveBeenLastCalledWith(
      USER,
      expect.objectContaining({
        institutionId: null,
        institutionName: "Imperial College London",
        academicYear: 4,
      })
    );
  });
});
