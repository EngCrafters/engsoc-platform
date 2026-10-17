import { getPublicEvent } from "@/lib/events";
import { authenticate } from "@/lib/api/auth";
import { corsHeaders, isAllowedOrigin } from "@/lib/api/cors";
import { toEventDto } from "@/lib/api/dto";
import { json, problem, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=30, stale-while-revalidate=120";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> }
): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }

  const auth = await authenticate(request);
  if (!auth.ok) {
    return problem(
      auth.reason === "service-unavailable"
        ? "service-unavailable"
        : "unauthorized",
      requestId,
      { headers: cors }
    );
  }

  const { eventId } = await context.params;
  // A malformed id is rejected before any query, matching the domain's own
  // behaviour rather than sending garbage to PostgreSQL.
  if (!UUID.test(eventId)) {
    return problem("not-found", requestId, { headers: cors });
  }

  try {
    const event = await getPublicEvent(eventId);
    // Draft, archived and nonexistent are deliberately indistinguishable. A
    // 403 or a different message would confirm that a private event exists.
    if (!event) return problem("not-found", requestId, { headers: cors });
    return json(
      { data: toEventDto(event) },
      {
        requestId,
        cacheControl: CACHE,
        headers: cors,
      }
    );
  } catch {
    return problem("service-unavailable", requestId, { headers: cors });
  }
}
