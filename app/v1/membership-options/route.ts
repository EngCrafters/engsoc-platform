import { membershipOptions } from "@/lib/membership";
import {
  corsHeaders,
  isAllowedOrigin,
  preflight,
  type CorsPolicy,
} from "@/lib/api/cors";
import { logServerError } from "@/lib/api/log";
import { json, problem, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * The membership form's choices (ADR 0025): the categories with what each
 * collects, the listed institutions and the current consent version. Public
 * reference data, like the form it builds: no key, no cookie, exact-origin
 * CORS for browsers, and a short public cache.
 */
const READ_CORS: CorsPolicy = {
  methods: "GET, OPTIONS",
  headers: "X-Request-Id",
};

export function OPTIONS(request: Request): Response {
  return preflight(request, requestIdFrom(request), READ_CORS);
}

export async function GET(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, READ_CORS);
  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }
  try {
    return json(
      { data: await membershipOptions() },
      { requestId, cacheControl: "public, max-age=300", headers: cors }
    );
  } catch (error) {
    logServerError("membership_options_failed", error, requestId);
    return problem("service-unavailable", requestId, { headers: cors });
  }
}
