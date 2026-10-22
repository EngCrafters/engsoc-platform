import "server-only";
import { bearerToken, verifyMemberAccessToken } from "@/lib/auth/member";
import {
  corsHeaders,
  isAllowedOrigin,
  preflight,
  type CorsPolicy,
} from "@/lib/api/cors";
import { json, problem, requestIdFrom } from "@/lib/api/http";

export const MEMBER_CORS: CorsPolicy = {
  methods: "GET, POST, PATCH, OPTIONS",
  headers: "Authorization, Content-Type, X-Request-Id",
};
export function memberPreflight(request: Request) {
  return preflight(request, requestIdFrom(request), MEMBER_CORS);
}
export async function memberRequest(request: Request) {
  const requestId = requestIdFrom(request);
  const cors = corsHeaders(request.headers.get("origin"), MEMBER_CORS);
  const reply = (code: Parameters<typeof problem>[0]) =>
    problem(code, requestId, { headers: cors });
  if (
    request.headers.has("origin") &&
    !isAllowedOrigin(request.headers.get("origin"))
  )
    return { response: reply("forbidden") };
  const token = bearerToken(request);
  if (!token) return { response: reply("unauthorized") };
  const actor = await verifyMemberAccessToken(token);
  if (!actor.ok)
    return {
      response: reply(
        actor.reason === "unauthorized" ? "unauthorized" : "service-unavailable"
      ),
    };
  return { actor: actor.userId, requestId, cors };
}
export function memberResult(
  data: { code: string; field?: unknown },
  requestId: string,
  headers: Record<string, string>,
  successStatus = 200
) {
  if (data.code === "SUCCESS")
    return json(
      { data },
      { status: successStatus, requestId, cacheControl: "no-store", headers }
    );
  const code =
    data.code === "NOT_FOUND" || data.code === "EVENT_NOT_FOUND"
      ? "not-found"
      : ["MEMBER_REQUIRED", "EMAIL_UNCONFIRMED"].includes(data.code)
        ? "forbidden"
        : data.code === "RATE_LIMITED"
          ? "rate-limited"
          : ["PHONE_REQUIRED", "VALIDATION_ERROR"].includes(data.code)
            ? "invalid-fields"
            : [
                  "NOT_REGISTERED",
                  "WAITLISTED",
                  "CHECKIN_CLOSED",
                  "CHALLENGE_EXPIRED",
                  "INVALID_CHALLENGE",
                  "ALREADY_REGISTERED",
                  "ALREADY_WAITLISTED",
                  "EVENT_FULL",
                  "REGISTRATION_CLOSED",
                  "REGISTRATION_AVAILABLE",
                  "ALREADY_PENDING",
                  "UNCHANGED",
                  "CONFLICT",
                ].includes(data.code)
              ? "conflict"
              : "service-unavailable";
  const reasons: Record<string, string> = {
    ALREADY_REGISTERED: "already-registered",
    ALREADY_WAITLISTED: "already-waitlisted",
    EVENT_FULL: "event-full",
    REGISTRATION_CLOSED: "registration-closed",
    REGISTRATION_AVAILABLE: "registration-available",
  };
  return problem(code, requestId, {
    headers:
      code === "rate-limited" ? { ...headers, "retry-after": "600" } : headers,
    errors: [
      {
        field:
          data.code === "PHONE_REQUIRED"
            ? "phone"
            : typeof data.field === "string" &&
                /^[A-Za-z_]{1,40}$/.test(data.field)
              ? data.field
              : "attendance",
        code: data.code,
      },
    ],
    reason: reasons[data.code] as "already-registered" | undefined,
  });
}
