import { getOwnMembership } from "@/lib/membership";
import { bearerToken, verifyMemberAccessToken } from "@/lib/auth/member";
import {
  corsHeaders,
  isAllowedOrigin,
  preflight,
  type CorsPolicy,
} from "@/lib/api/cors";
import { json, problem, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * The signed-in visitor's own membership (ADR 0019). The website sends the
 * visitor's Supabase access token as a Bearer header; Supabase Auth verifies it
 * and the database answers for that identity only. No cookie, no API key, no
 * user ID from the request. The answer is a status and dates: no note,
 * reviewer, student ID or document. A signed-in account is not a member until
 * the database says so.
 */
const MEMBER_CORS: CorsPolicy = {
  methods: "GET, OPTIONS",
  headers: "Authorization, X-Request-Id",
};

export function OPTIONS(request: Request): Response {
  return preflight(request, requestIdFrom(request), MEMBER_CORS);
}

export async function GET(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, MEMBER_CORS);
  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }

  const token = bearerToken(request);
  if (!token) return problem("unauthorized", requestId, { headers: cors });
  const identity = await verifyMemberAccessToken(token);
  if (!identity.ok) {
    return problem(
      identity.reason === "unauthorized"
        ? "unauthorized"
        : "service-unavailable",
      requestId,
      { headers: cors }
    );
  }

  const result = await getOwnMembership(identity.userId);
  if (!result.ok) {
    return problem("service-unavailable", requestId, { headers: cors });
  }
  return json(
    {
      data: result.emailConfirmed
        ? {
            emailConfirmed: true,
            member: result.member,
            application: result.application,
          }
        : { emailConfirmed: false, member: null, application: null },
    },
    { requestId, cacheControl: "private, no-store", headers: cors }
  );
}
