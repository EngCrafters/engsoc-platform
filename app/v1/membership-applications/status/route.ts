import { getApplicationStatus, isStatusToken } from "@/lib/membership";
import { corsHeaders, isAllowedOrigin, preflight } from "@/lib/api/cors";
import { json, problem, readJsonBody, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * The applicant's own application status (ADR 0017). The 256-bit token returned
 * at submission is the only credential; it travels in the body (never a URL,
 * where it would reach logs) and Core stores only its hash. The answer is a
 * status and dates: no name, email, student ID, reviewer or note.
 */

export function OPTIONS(request: Request): Response {
  return preflight(request, requestIdFrom(request));
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);
  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }

  const body = await readJsonBody(request);
  if (!body.ok) return problem(body.reason, requestId, { headers: cors });
  const record =
    typeof body.value === "object" &&
    body.value !== null &&
    !Array.isArray(body.value)
      ? (body.value as Record<string, unknown>)
      : null;
  if (!record) return problem("bad-request", requestId, { headers: cors });
  const unexpected = Object.keys(record).filter((key) => key !== "statusToken");
  if (unexpected.length > 0 || !isStatusToken(record.statusToken)) {
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors:
        unexpected.length > 0
          ? unexpected.map((field) => ({ field, code: "unexpected-field" }))
          : [{ field: "statusToken", code: "invalid" }],
    });
  }

  const result = await getApplicationStatus(record.statusToken);
  if (!result.ok) {
    return problem(
      result.error === "not_found" ? "not-found" : "service-unavailable",
      requestId,
      { headers: cors }
    );
  }
  return json(
    {
      data: {
        status: result.status,
        submittedAt: result.submittedAt,
        decidedAt: result.decidedAt,
        activated: result.activated,
      },
    },
    { requestId, cacheControl: "no-store", headers: cors }
  );
}
