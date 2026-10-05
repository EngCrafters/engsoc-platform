import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: auth.verifyOtp,
      exchangeCodeForSession: auth.exchangeCodeForSession,
    },
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "../app/auth/callback/route";

function request(path: string, cookie?: string) {
  return new NextRequest(`https://app.example${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

function where(response: Response) {
  const location = new URL(response.headers.get("location") ?? "");
  return `${location.pathname}${location.search}`;
}

describe("/auth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
    auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  });

  it("verifies a recovery token hash on any device, then opens the reset page", async () => {
    const response = await GET(
      request("/auth/callback?token_hash=abc&type=recovery")
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "abc",
    });
    expect(where(response)).toBe("/auth/reset");
  });

  it("exchanges a PKCE code for the browser that requested recovery", async () => {
    const response = await GET(
      request("/auth/callback?code=pkce", "es-recovery-intent=1")
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("pkce");
    expect(where(response)).toBe("/auth/reset");
  });

  it("keeps older next=/auth/reset links working", async () => {
    const response = await GET(
      request("/auth/callback?code=pkce&next=/auth/reset")
    );
    expect(where(response)).toBe("/auth/reset");
  });

  it("reports an expired recovery link on the recovery page", async () => {
    auth.verifyOtp.mockResolvedValue({
      error: { code: "otp_expired", message: "Email link has expired" },
    });
    const response = await GET(
      request("/auth/callback?token_hash=abc&type=recovery")
    );
    expect(where(response)).toBe("/admin/recovery?link=expired");
  });

  it("reports an invalid recovery link and never opens the reset page", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      error: { code: "validation_failed" },
    });
    const response = await GET(
      request("/auth/callback?code=bad&next=/auth/reset")
    );
    expect(where(response)).toBe("/admin/recovery?link=invalid");
  });

  it("treats a thrown Auth error as an invalid link", async () => {
    auth.verifyOtp.mockRejectedValue(new Error("network"));
    const response = await GET(
      request("/auth/callback?token_hash=abc&type=recovery")
    );
    expect(where(response)).toBe("/admin/recovery?link=invalid");
  });

  it("falls back to the destination when no code arrives, so the fragment relay can finish", async () => {
    const response = await GET(request("/auth/callback"));
    expect(where(response)).toBe("/admin/events");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects unsupported link types without calling Auth", async () => {
    const response = await GET(
      request("/auth/callback?token_hash=abc&type=sms")
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(where(response)).toBe("/admin/events");
  });

  it("does not follow an external next parameter after sign-in", async () => {
    const response = await GET(
      request("/auth/callback?code=ok&next=https://evil.example/steal")
    );
    expect(where(response)).toBe("/admin/events");
  });
});
