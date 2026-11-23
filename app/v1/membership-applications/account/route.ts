import { isStatusToken, setUpImmediateAccount } from "@/lib/membership";
import { corsHeaders, isAllowedOrigin, preflight } from "@/lib/api/cors";
import { json, problem, readJsonBody, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * Immediate account activation (ADR 0030). The browser that just registered sends its 256-bit
 * status token (in the body, never a URL). If the application was submitted under immediate
 * activation, Core creates the registrant's account server-side with the Supabase Auth Admin API
 * (no confirmation email, no password), links it, writes the member record when the application
 * is approved, and answers with one sign-in token hash. The browser signs in with it and sets its
 * own password directly with Supabase Auth.
 *
 * Refusals (409 with a reason): `confirmation-required` (the application uses email
 * confirmation: use Supabase sign-up), `account-exists` (that address already has an account,
 * which is never signed in to here), `already-set-up` (this account has signed in already),
 * `expired` (more than an hour after submission). 503 `not-configured` when this server cannot
 * create accounts; the website then falls back to email confirmation.
 */

export function OPTIONS(request: Request): Response {
  return preflight(request, requestIdFrom(request));
}

const REASONS = {
  confirmation_required: "confirmation-required",
  account_exists: "account-exists",
  already_set_up: "already-set-up",
  expired: "expired",
} as const;

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

  const result = await setUpImmediateAccount(record.statusToken);
  if (result.ok) {
    return json(
      { data: { tokenHash: result.tokenHash, member: result.member } },
      { status: 201, requestId, cacheControl: "no-store", headers: cors }
    );
  }
  if (result.error === "not_found") {
    return problem("not-found", requestId, { headers: cors });
  }
  if (result.error === "not_configured") {
    return problem("service-unavailable", requestId, {
      headers: cors,
      reason: "not-configured",
    });
  }
  if (result.error === "server_error") {
    return problem("service-unavailable", requestId, { headers: cors });
  }
  return problem("conflict", requestId, {
    headers: cors,
    reason: REASONS[result.error],
  });
}
