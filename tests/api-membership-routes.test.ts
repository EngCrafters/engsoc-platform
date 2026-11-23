import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Transport behaviour of the public membership endpoints (ADRs 0017 and 0025):
 * origin policy, multipart handling and bounds, field errors, the category
 * rules, the previous website's form, and the mapping of domain outcomes to the
 * published problem vocabulary. Validation rules and the database are covered
 * by tests/membership-domain.test.ts and tests/db/development-cycle-2.test.ts.
 */

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  status: vi.fn(),
  options: vi.fn(),
}));

vi.mock("@/lib/membership/db", () => ({
  submitThroughRoutine: state.submit,
  statusThroughRoutine: state.status,
  optionsThroughRoutine: state.options,
}));

const { POST, OPTIONS } =
  await import("@/app/v1/membership-applications/route");
const { POST: STATUS } =
  await import("@/app/v1/membership-applications/status/route");
const { GET: OPTIONS_GET } = await import("@/app/v1/membership-options/route");
const { resetMembershipOptionsCache } = await import("@/lib/membership");

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const TOKEN = "A".repeat(43);
const DB_OPTIONS = {
  code: "SUCCESS",
  categories: [
    {
      id: "university_student",
      label: { en: "University Student", ar: "طالب جامعي" },
      institution: "required",
      academicYear: true,
    },
    {
      id: "industry_professional",
      label: { en: "Industry Professional", ar: "مهني" },
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
    { id: "utas", name: { en: "UTAS", ar: "جامعة التقنية" }, country: "OM" },
  ],
  consentVersion: "2026-11-v2",
};

function form(overrides: Record<string, string | string[] | null> = {}) {
  const data = new FormData();
  const base: Record<string, string | string[] | null> = {
    fullName: "Aisha Al-Hinai",
    email: "aisha@example.org",
    category: "university_student",
    institution: "utas",
    academicYear: "2",
    discipline: "civil",
    interests: ["cad"],
    consent: "true",
    consentVersion: "2026-11-v2",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    if (value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

function post(body: FormData | string, headers: Record<string, string> = {}) {
  return new Request("https://api.essqu.com/v1/membership-applications", {
    method: "POST",
    headers: {
      origin: "https://essqu.com",
      "x-vercel-forwarded-for": "203.0.113.9",
      ...headers,
    },
    body,
  });
}

beforeEach(() => {
  resetMembershipOptionsCache();
  state.submit.mockReset().mockResolvedValue({
    code: "SUCCESS",
    applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  state.status.mockReset();
  state.options.mockReset().mockResolvedValue(DB_OPTIONS);
});

describe("POST /v1/membership-applications", () => {
  it("stores a valid application with no document and returns its status token once, uncached", async () => {
    const res = await POST(post(form()));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://essqu.com"
    );
    const body = await res.json();
    expect(body.data.status).toBe("pending_review");
    expect(body.data.statusToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(body)).not.toContain("aaaaaaaa");

    const sent = state.submit.mock.calls[0][0];
    expect(sent).toEqual({
      fullName: "Aisha Al-Hinai",
      email: "aisha@example.org",
      category: "university_student",
      institutionId: "utas",
      institutionName: null,
      academicYear: 2,
      discipline: "civil",
      interests: ["cad"],
      consentVersion: "2026-11-v2",
      statusTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      ipAddress: "203.0.113.9",
    });
    expect(sent.statusTokenHash).not.toBe(body.data.statusToken);
  });

  it("reports an application the automatic policy approved (ADR 0029)", async () => {
    state.submit.mockResolvedValue({
      code: "SUCCESS",
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      status: "approved",
    });
    const res = await POST(post(form()));
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("approved");
  });

  it("reports the account activation mode recorded with the application (ADR 0030)", async () => {
    state.submit.mockResolvedValue({
      code: "SUCCESS",
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      status: "approved",
      accountActivation: "immediate",
    });
    expect(
      (await (await POST(post(form()))).json()).data.accountActivation
    ).toBe("immediate");
    // A database before 0038 does not say: email confirmation, as before.
    state.submit.mockResolvedValue({
      code: "SUCCESS",
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(
      (await (await POST(post(form()))).json()).data.accountActivation
    ).toBe("email_confirmation");
  });

  it("never reports a status the database did not give as approved", async () => {
    state.submit.mockResolvedValue({
      code: "SUCCESS",
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      status: "member",
    });
    expect((await (await POST(post(form()))).json()).data.status).toBe(
      "pending_review"
    );
  });

  it("drops details the chosen category does not collect", async () => {
    const res = await POST(
      post(
        form({
          category: "industry_professional",
          institution: "other",
          institutionName: "Left over",
          academicYear: "4",
        })
      )
    );
    expect(res.status).toBe(201);
    expect(state.submit.mock.calls[0][0]).toMatchObject({
      category: "industry_professional",
      institutionId: null,
      institutionName: null,
      academicYear: null,
    });
  });

  it("accepts the previous website's SQU form for one release, discarding its student ID and card", async () => {
    const data = form({
      category: null,
      institution: null,
      email: "s123456@squ.edu.om",
      consentVersion: "2026-10-v1",
      universityId: "123456",
    });
    data.append("idDocument", new Blob([PNG]), "card.png");
    const res = await POST(post(data));
    expect(res.status).toBe(201);
    const sent = state.submit.mock.calls[0][0];
    expect(sent).toMatchObject({
      category: "university_student",
      institutionId: "squ",
      academicYear: 2,
      consentVersion: "2026-10-v1",
    });
    expect(Object.keys(sent)).not.toContain("universityId");
    expect(Object.keys(sent)).not.toContain("document");
    expect(Object.values(sent)).not.toContain("123456");
  });

  it("refuses a foreign origin before reading anything", async () => {
    const res = await POST(post(form(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("accepts only multipart/form-data", async () => {
    const res = await POST(
      post(JSON.stringify({ fullName: "x" }), {
        "content-type": "application/json",
      })
    );
    expect(res.status).toBe(415);
  });

  it("refuses a declared body over the limit without reading it", async () => {
    const res = await POST(
      post(form(), { "content-length": String(5_000_000) })
    );
    expect(res.status).toBe(413);
  });

  it("refuses unexpected fields, including any attempt to choose a status or role", async () => {
    const data = form();
    data.append("status", "approved");
    data.append("accessLevel", "TECHNICAL");
    const res = await POST(post(data));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([
      { field: "status", code: "unexpected-field" },
      { field: "accessLevel", code: "unexpected-field" },
    ]);
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("names invalid fields", async () => {
    const res = await POST(
      post(form({ email: "not-an-email", academicYear: "9", institution: "" }))
    );
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([
      { field: "email", code: "invalid" },
      { field: "institution", code: "required" },
      { field: "academicYear", code: "invalid" },
    ]);
  });

  it("rejects a repeated scalar", async () => {
    const res = await POST(
      post(form({ email: ["a@example.org", "b@example.org"] }))
    );
    expect((await res.json()).errors).toEqual([
      { field: "email", code: "invalid" },
    ]);
  });

  it("is unavailable, not invalid, when the categories cannot be read", async () => {
    state.options.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post(form()));
    expect(res.status).toBe(503);
    expect(state.submit).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it.each([
    ["ALREADY_APPLIED", 409, "already-applied"],
    ["ALREADY_MEMBER", 409, "already-member"],
    ["RATE_LIMITED", 429, undefined],
    ["SERVER_ERROR", 503, undefined],
    ["INVALID_IP", 503, undefined],
  ])("maps %s to %i", async (code, status, reason) => {
    state.submit.mockResolvedValue({ code });
    const res = await POST(post(form()));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.reason).toBe(reason);
    if (status === 429) expect(res.headers.get("retry-after")).toBe("3600");
  });

  it("refuses when the client address cannot be trusted", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await POST(post(form(), { "x-vercel-forwarded-for": "" }));
      expect(res.status).toBe(503);
      expect(state.submit).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers the CORS preflight like registration", () => {
    const res = OPTIONS(
      new Request("https://api.essqu.com/v1/membership-applications", {
        method: "OPTIONS",
        headers: { origin: "https://essqu.com" },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("GET /v1/membership-options", () => {
  const get = (origin = "https://essqu.com") =>
    OPTIONS_GET(
      new Request("https://api.essqu.com/v1/membership-options", {
        headers: { origin },
      })
    );

  it("publishes the categories and institutions with a short public cache", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("vary")).toBe("Origin");
    const { data } = await res.json();
    expect(data.categories.map((c: { id: string }) => c.id)).toEqual([
      "university_student",
      "industry_professional",
    ]);
    expect(data.institutions[0].name.ar).toBe("جامعة السلطان قابوس");
    expect(data.consentVersion).toBe("2026-11-v2");
    // A database before 0037 does not say: membership waits for review.
    expect(data.approval).toBe("review");
    // Before 0038, accounts need email confirmation.
    expect(data.accountActivation).toBe("email_confirmation");
  });

  it("says when registrations are approved automatically (ADR 0029)", async () => {
    state.options.mockResolvedValue({ ...DB_OPTIONS, approval: "automatic" });
    expect((await (await get()).json()).data.approval).toBe("automatic");
    resetMembershipOptionsCache();
    state.options.mockResolvedValue({ ...DB_OPTIONS, approval: "sometimes" });
    expect((await (await get()).json()).data.approval).toBe("review");
  });

  it("refuses a foreign origin and reports an unavailable database as 503", async () => {
    expect((await get("https://evil.example")).status).toBe(403);
    state.options.mockResolvedValue({ code: "SERVER_ERROR" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get()).status).toBe(503);
    vi.restoreAllMocks();
  });
});

describe("POST /v1/membership-applications/status", () => {
  const ask = (body: unknown) =>
    STATUS(
      new Request("https://api.essqu.com/v1/membership-applications/status", {
        method: "POST",
        headers: {
          origin: "https://essqu.com",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      })
    );

  it("returns only status and dates for a known token", async () => {
    state.status.mockResolvedValue({
      code: "SUCCESS",
      status: "pending_review",
      submittedAt: "2026-10-20T10:00:00Z",
      decidedAt: null,
      activated: false,
    });
    const res = await ask({ statusToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      data: {
        status: "pending_review",
        submittedAt: "2026-10-20T10:00:00.000Z",
        decidedAt: null,
        activated: false,
      },
    });
    expect(state.status.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is 404 for an unknown token and 422 for a malformed one or an extra field", async () => {
    state.status.mockResolvedValue({ code: "NOT_FOUND" });
    expect((await ask({ statusToken: TOKEN })).status).toBe(404);
    expect((await ask({ statusToken: "short" })).status).toBe(422);
    expect(
      (await ask({ statusToken: TOKEN, email: "x@squ.edu.om" })).status
    ).toBe(422);
  });
});
