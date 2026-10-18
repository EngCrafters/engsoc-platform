import { getPublicEventPage } from "@/lib/events";
import { authenticate } from "@/lib/api/auth";
import { corsHeaders, isAllowedOrigin } from "@/lib/api/cors";
import { toEventListDto } from "@/lib/api/dto";
import { json, problem, requestIdFrom } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** Event reads are public data behind a scoped client credential. */
const CACHE = "public, s-maxage=30, stale-while-revalidate=120";

function periodFrom(value: string | null): "upcoming" | "past" {
  return value === "past" ? "past" : "upcoming";
}

export async function GET(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  // CORS is not authentication, but a browser call from an unlisted origin is
  // refused before any work happens. Non-browser callers simply have no Origin.
  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }

  const auth = await authenticate(request);
  if (!auth.ok) {
    return problem(auth.reason, requestId, { headers: cors });
  }

  try {
    const url = new URL(request.url);
    const page = await getPublicEventPage({
      period: periodFrom(url.searchParams.get("period")),
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    // One canonical list call. No per-event lookup, no availability arithmetic
    // here — the routine already returned it.
    return json(toEventListDto(page), {
      requestId,
      cacheControl: CACHE,
      headers: cors,
    });
  } catch {
    return problem("service-unavailable", requestId, { headers: cors });
  }
}
