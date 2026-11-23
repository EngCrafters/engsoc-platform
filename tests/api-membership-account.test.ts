import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /v1/membership-applications/account (ADR 0030): immediate account activation. The
 * database routines and the Auth Admin API are replaced here; their own rules are covered by
 * tests/db/account-activation.test.ts. What this proves: the email and account ID come only from
 * the database, a sign-in token is produced only for the account Core created or reserved, every
 * refusal maps to its published reason, and a server without the service-role key answers
 * "not-configured" so the website can fall back to email confirmation.
 */

const state = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
}));

vi.mock("@/lib/membership/db", () => ({
  beginImmediateAccountThroughRoutine: state.begin,
  completeImmediateAccountThroughRoutine: state.complete,
}));
vi.mock("@/lib/auth/admin", () => ({
  createImmediateAccount: state.create,
  createSignInTokenHash: state.link,
}));

const { POST } = await import("@/app/v1/membership-applications/account/route");

const TOKEN = "B".repeat(43);
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const USER = "11111111-2222-4333-8444-555555555555";
const APP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EMAIL = "registrant@example.org";

function post(body: unknown, origin = "https://essqu.com") {
  return new Request(
    "https://api.essqu.com/v1/membership-applications/account",
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );
}

beforeEach(() => {
  state.begin.mockReset().mockResolvedValue({
    code: "CREATE",
    userId: USER,
    email: EMAIL,
    applicationId: APP,
  });
  state.complete
    .mockReset()
    .mockResolvedValue({ code: "SUCCESS", member: true });
  state.create.mockReset().mockResolvedValue({ code: "SUCCESS", userId: USER });
  state.link
    .mockReset()
    .mockResolvedValue({ code: "SUCCESS", tokenHash: "f".repeat(56) });
});

describe("POST /v1/membership-applications/account", () => {
  it("creates the reserved account from database values, links it and returns one sign-in token, uncached", async () => {
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://essqu.com"
    );
    expect(await res.json()).toMatchObject({
      data: { tokenHash: "f".repeat(56), member: true },
    });
    // Only the token's hash reaches the database; the email and ID come back from it.
    expect(state.begin).toHaveBeenCalledWith(TOKEN_HASH);
    expect(state.create).toHaveBeenCalledWith({
      id: USER,
      email: EMAIL,
      applicationId: APP,
    });
    expect(state.complete).toHaveBeenCalledWith(TOKEN_HASH, USER);
    expect(state.link).toHaveBeenCalledWith(EMAIL);
  });

  it("on a retry, signs in to the account it created earlier without creating another", async () => {
    state.begin.mockResolvedValue({
      code: "LINK",
      userId: USER,
      email: EMAIL,
      applicationId: APP,
    });
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(201);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("never signs in to an address that already had an account", async () => {
    state.create.mockResolvedValue({ code: "EMAIL_EXISTS" });
    state.begin
      .mockResolvedValueOnce({
        code: "CREATE",
        userId: USER,
        email: EMAIL,
        applicationId: APP,
      })
      .mockResolvedValueOnce({ code: "ACCOUNT_EXISTS" });
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("account-exists");
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.link).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_IMMEDIATE", "confirmation-required"],
    ["ACCOUNT_EXISTS", "account-exists"],
    ["ALREADY_SET_UP", "already-set-up"],
    ["EXPIRED", "expired"],
  ])("maps %s to 409 %s and touches no account", async (code, reason) => {
    state.begin.mockResolvedValue({ code });
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe(reason);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.link).not.toHaveBeenCalled();
  });

  it("stops if the database refuses to link, and issues no token", async () => {
    state.complete.mockResolvedValue({ code: "ALREADY_SET_UP" });
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("already-set-up");
    expect(state.link).not.toHaveBeenCalled();
  });

  it("answers 503 not-configured when this server cannot create accounts", async () => {
    state.create.mockResolvedValue({ code: "UNAVAILABLE" });
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("not-configured");
    expect(state.complete).not.toHaveBeenCalled();
  });

  it("answers 503 without a reason when the sign-in token cannot be made", async () => {
    state.link.mockResolvedValue({ code: "UNAVAILABLE" });
    const res = await POST(post({ statusToken: TOKEN }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBeUndefined();
  });

  it("refuses unknown tokens, malformed bodies, extra fields and foreign origins", async () => {
    state.begin.mockResolvedValue({ code: "NOT_FOUND" });
    expect((await POST(post({ statusToken: TOKEN }))).status).toBe(404);
    expect((await POST(post({ statusToken: "short" }))).status).toBe(422);
    expect(
      (await POST(post({ statusToken: TOKEN, email: "x@example.org" }))).status
    ).toBe(422);
    expect((await POST(post("not json"))).status).toBe(400);
    expect(
      (await POST(post({ statusToken: TOKEN }, "https://evil.example"))).status
    ).toBe(403);
  });
});
