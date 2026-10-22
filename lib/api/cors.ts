import "server-only";

/**
 * Exact-origin CORS for the public registration endpoint.
 *
 * Deliberate choices:
 *
 *  - **Exact match only.** No wildcard, no `*.vercel.app`, no subdomain
 *    suffix matching. A preview URL is not a production origin.
 *  - **No `Access-Control-Allow-Credentials`.** Registration uses no cookie and
 *    no credential, so the header would only widen the surface.
 *  - **`Vary: Origin` always**, so a shared cache cannot hand one origin's
 *    response to another.
 *
 * CORS is a browser control, not authentication: a bot can forge an Origin
 * header. It is defence in depth on top of canonical validation, the database
 * rate limiter and the duplicate constraint — never a substitute for them.
 */

const DEFAULT_ALLOWED_ORIGINS = ["https://essqu.com", "https://www.essqu.com"];

/**
 * Allowed origins come from configuration so a staging landing site can be
 * added without a code change, and so production does not silently accept a
 * preview origin.
 */
export function allowedOrigins(): string[] {
  const configured = process.env.CORE_API_ALLOWED_ORIGINS;
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin);
}

/**
 * What a route lets the browser send. The default is the registration endpoints'
 * (POST, no credential header); a route that reads with the visitor's own
 * Supabase session (ADR 0019) allows GET and `Authorization`, never cookies.
 */
export type CorsPolicy = { methods: string; headers: string };
const DEFAULT_POLICY: CorsPolicy = {
  methods: "POST, OPTIONS",
  headers: "Content-Type, X-Request-Id",
};

/** Headers for an allowed origin, or just `Vary` when it is not allowed. */
export function corsHeaders(
  origin: string | null,
  policy: CorsPolicy = DEFAULT_POLICY
): Record<string, string> {
  const base: Record<string, string> = { vary: "Origin" };
  if (!isAllowedOrigin(origin)) return base;
  return {
    ...base,
    "access-control-allow-origin": origin as string,
    "access-control-allow-methods": policy.methods,
    "access-control-allow-headers": policy.headers,
    "access-control-expose-headers": "X-Request-Id, Retry-After",
    "access-control-max-age": "600",
  };
}

/**
 * Answer a preflight.
 *
 * A disallowed origin gets a 204 with no allow-origin header: the browser then
 * blocks the real request. Returning 403 here would tell a scanner which origins
 * are configured, and gains nothing.
 */
export function preflight(
  request: Request,
  requestId: string,
  policy: CorsPolicy = DEFAULT_POLICY
): Response {
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, policy),
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
