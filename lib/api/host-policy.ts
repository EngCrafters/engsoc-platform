import "server-only";

/**
 * Host boundary for the Core project (ADR 0016, section 27 of the program).
 *
 * The same Next.js project will answer on two hostnames:
 *
 *   api.essqu.com    -> the public /v1 API only
 *   admin.essqu.com  -> administration and Auth only
 *
 * Serving both trees on both hosts would leave the public API reachable behind
 * the admin hostname and the admin UI reachable behind the API hostname. The
 * brief is explicit that this must not be left ambiguous.
 *
 * DORMANT BY DESIGN
 * -----------------
 * Enforcement is OFF unless CORE_API_HOST_ENFORCEMENT is exactly "true". The
 * domains are not attached yet, and switching on strict host rules before the
 * hostnames exist and are tested would take the working deployment down. So the
 * policy ships, is unit tested, and waits for the cutover.
 *
 * The decision is a pure function of (host, path) so it can be tested without a
 * server, and so the cutover is a configuration change rather than a code change.
 */

export const API_HOST = "api.essqu.com";
export const ADMIN_HOST = "admin.essqu.com";

export type HostClass = "api" | "admin" | "local" | "preview" | "unknown-host";

/** Only the one flag matters, so the parameter stays structural and testable. */
export type HostEnv = Record<string, string | undefined>;

export function hostEnforcementEnabled(env: HostEnv = process.env): boolean {
  return env.CORE_API_HOST_ENFORCEMENT === "true";
}

/**
 * Classify a Host header.
 *
 * Deliberately not trusting forwarded-host headers: Vercel normalises `Host` at
 * the edge, and a client-supplied `x-forwarded-host` is just a request header.
 */
export function classifyHost(host: string | null): HostClass {
  if (!host) return "unknown-host";
  const bare = host.trim().toLowerCase().replace(/:\d+$/, "");
  if (bare === API_HOST) return "api";
  if (bare === ADMIN_HOST) return "admin";
  if (bare === "localhost" || bare === "127.0.0.1") return "local";
  if (/\.vercel\.app$/.test(bare)) return "preview";
  return "unknown-host";
}

const isApiPath = (pathname: string): boolean =>
  pathname === "/v1" || pathname.startsWith("/v1/");

/**
 * Is this path served on this host?
 *
 * - api host: only /v1. Admin and Auth are not served here.
 * - admin host: admin and Auth only. /v1 is not served here, so there is exactly
 *   one canonical API host.
 * - local, preview and unknown hosts: everything, so development and Preview
 *   keep working and an unattached hostname cannot brick the deployment.
 */
export function isPathAllowedOnHost(
  hostClass: HostClass,
  pathname: string
): boolean {
  switch (hostClass) {
    case "api":
      return isApiPath(pathname);
    case "admin":
      return !isApiPath(pathname);
    case "local":
    case "preview":
    case "unknown-host":
      return true;
  }
}

export type HostVerdict = { ok: true } | { ok: false; reason: "host-mismatch" };

/**
 * The single decision the request boundary consults.
 *
 * Returns `{ ok: true }` while enforcement is disabled, which is the current
 * production state.
 */
export function checkHostRoute(
  host: string | null,
  pathname: string,
  env: HostEnv = process.env
): HostVerdict {
  if (!hostEnforcementEnabled(env)) return { ok: true };
  if (isPathAllowedOnHost(classifyHost(host), pathname)) return { ok: true };
  return { ok: false, reason: "host-mismatch" };
}
