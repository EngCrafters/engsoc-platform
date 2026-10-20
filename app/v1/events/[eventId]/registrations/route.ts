import { registerForEvent } from "@/lib/registrations";
import { resolveClientIp } from "@/lib/client-ip/server";
import { corsHeaders, isAllowedOrigin, preflight } from "@/lib/api/cors";
import {
  publicCodeFor,
  registrationConflictReasonFor,
  toRegistrationDto,
} from "@/lib/api/dto";
import { json, problem, readJsonBody, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registration writes, so it is never cached. */
const NO_STORE = "no-store";

const ALLOWED_KEYS = new Set([
  "attendeeName",
  "attendeeEmail",
  "intent",
  "attendeePhone",
]);

export function OPTIONS(request: Request): Response {
  return preflight(request, requestIdFrom(request));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string }> }
): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }

  const { eventId } = await context.params;

  // Transport validation only. Capacity, waitlist ordering, duplicate state,
  // registration-open state and the rate limit all live in the canonical domain
  // and its database routine; reimplementing any of it here is how two
  // implementations drift apart.
  if (!UUID.test(eventId)) {
    return problem("not-found", requestId, { headers: cors });
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return problem(body.reason, requestId, { headers: cors });
  }
  if (
    typeof body.value !== "object" ||
    body.value === null ||
    Array.isArray(body.value)
  ) {
    return problem("bad-request", requestId, { headers: cors });
  }

  const record = body.value as Record<string, unknown>;

  const unexpected = Object.keys(record).filter(
    (key) => !ALLOWED_KEYS.has(key)
  );
  if (unexpected.length > 0) {
    // This is also how an attempted "ipAddress" in the body is refused: the
    // client address is derived from the request server-side and can never be
    // supplied by the caller.
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors: unexpected.map((field) => ({ field, code: "unexpected-field" })),
    });
  }

  const fieldErrors: { field: string; code: string }[] = [];
  if (typeof record.attendeeName !== "string") {
    fieldErrors.push({ field: "attendeeName", code: "required" });
  }
  if (typeof record.attendeeEmail !== "string") {
    fieldErrors.push({ field: "attendeeEmail", code: "required" });
  }
  const intent = record.intent ?? "register";
  if (
    record.attendeePhone !== undefined &&
    typeof record.attendeePhone !== "string"
  )
    fieldErrors.push({ field: "attendeePhone", code: "invalid" });
  if (intent !== "register" && intent !== "join_waitlist") {
    fieldErrors.push({ field: "intent", code: "invalid" });
  }
  if (fieldErrors.length > 0) {
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors: fieldErrors,
    });
  }

  const ip = resolveClientIp(request.headers);
  if (!ip.ok) {
    // Without a trustworthy client address there is no trustworthy rate-limit
    // key, so the request is refused rather than let through unmetered.
    return problem("service-unavailable", requestId, { headers: cors });
  }

  try {
    const result = await registerForEvent({
      eventId,
      attendeeName: record.attendeeName as string,
      attendeeEmail: record.attendeeEmail as string,
      intent: intent as "register" | "join_waitlist",
      ipAddress: ip.ip,
      ...(typeof record.attendeePhone === "string"
        ? { attendeePhone: record.attendeePhone }
        : {}),
    });

    if (!result.ok) {
      const code = publicCodeFor(result.error);
      const headers: Record<string, string> = { ...cors };
      // The canonical limiter is a rolling ten-minute window, so that is the
      // honest retry hint.
      if (code === "rate-limited") headers["retry-after"] = "600";
      return problem(code, requestId, {
        headers,
        reason: registrationConflictReasonFor(result.error),
        ...(result.error === "phone_required"
          ? { errors: [{ field: "attendeePhone", code: "required" }] }
          : {}),
      });
    }

    return json(toRegistrationDto(result), {
      status: 201,
      requestId,
      cacheControl: NO_STORE,
      headers: cors,
    });
  } catch {
    return problem("service-unavailable", requestId, { headers: cors });
  }
}
