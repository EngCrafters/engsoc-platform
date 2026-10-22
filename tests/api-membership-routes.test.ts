import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Transport behaviour of the public membership endpoints (ADR 0017): origin
 * policy, multipart handling and bounds, field errors, and the mapping of
 * domain outcomes to the published problem vocabulary. Validation rules and the
 * database are covered by tests/membership-domain.test.ts and
 * tests/db/membership.test.ts.
 */

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/lib/membership/db", () => ({
  submitThroughRoutine: state.submit,
  statusThroughRoutine: state.status,
}));

const { POST, OPTIONS } =
  await import("@/app/v1/membership-applications/route");
const { POST: STATUS } =
  await import("@/app/v1/membership-applications/status/route");

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const TOKEN = "A".repeat(43);

function form(
  overrides: Record<string, string | string[] | null> = {},
  file: Blob | null = new Blob([PNG])
) {
  const data = new FormData();
  const base: Record<string, string | string[] | null> = {
    fullName: "Aisha Al-Hinai",
    email: "s123456@squ.edu.om",
    universityId: "123456",
    academicYear: "2",
    discipline: "civil",
    interests: ["cad"],
    consent: "true",
    consentVersion: "2026-10-v1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    if (value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  if (file) data.append("idDocument", file, "card.png");
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
  state.submit.mockReset().mockResolvedValue({
    code: "SUCCESS",
    applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  state.status.mockReset();
});

describe("POST /v1/membership-applications", () => {
  it("stores a valid application and returns its status token once, uncached", async () => {
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
    expect(sent).toMatchObject({
      email: "s123456@squ.edu.om",
      mediaType: "image/png",
      ipAddress: "203.0.113.9",
    });
    expect(sent.statusTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.statusTokenHash).not.toBe(body.data.statusToken);
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

  it("names invalid fields, including a file that is not an image or PDF", async () => {
    const res = await POST(
      post(
        form(
          { email: "a@gmail.com", academicYear: "9" },
          new Blob(["<svg/>"], { type: "image/png" })
        )
      )
    );
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([
      { field: "email", code: "invalid" },
      { field: "academicYear", code: "invalid" },
      { field: "idDocument", code: "unsupported-type" },
    ]);
  });

  it("requires the ID card and rejects a repeated scalar", async () => {
    expect((await (await POST(post(form({}, null)))).json()).errors).toEqual([
      { field: "idDocument", code: "required" },
    ]);
    const res = await POST(
      post(form({ email: ["a@squ.edu.om", "b@squ.edu.om"] }))
    );
    expect((await res.json()).errors).toEqual([
      { field: "email", code: "invalid" },
    ]);
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
