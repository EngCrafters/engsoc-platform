import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * The person behind a Supabase access token that the public website sends as a
 * Bearer header (ADR 0019). Supabase Auth verifies the token itself; the actor
 * is the user it returns (ADR 0015), never anything the request claims. This
 * proves only who is signed in: membership and administrative access are
 * decided separately, by the database.
 */

// Header.payload.signature, base64url: anything else is not a session token
// (for example an `essq_` API key) and never reaches Supabase.
const JWT_SHAPE =
  /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

export type MemberTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauthorized" | "unavailable" };

export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? ""
  );
  return match ? match[1] : null;
}

export async function verifyMemberAccessToken(
  token: string
): Promise<MemberTokenResult> {
  if (token.length > 4096 || !JWT_SHAPE.test(token)) {
    return { ok: false, reason: "unauthorized" };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, reason: "unavailable" };
  try {
    const client = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await client.auth.getUser(token);
    if (data.user) return { ok: true, userId: data.user.id };
    // Supabase answers a bad, expired or revoked token with 4xx; anything else
    // is Supabase being unreachable, which must not look like "signed out".
    const status = (error as { status?: number } | null)?.status ?? 0;
    return {
      ok: false,
      reason: status >= 400 && status < 500 ? "unauthorized" : "unavailable",
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
