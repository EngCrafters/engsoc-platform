import "server-only";

import { isIP } from "node:net";

/**
 * The single place the platform decides "who is calling".
 *
 * WHY THIS IS CENTRALIZED (F-05)
 * ------------------------------
 * Registration is rate limited per client IP inside
 * `private.register_for_event`, so the IP is a security input, not telemetry.
 * Before the public API existed this logic was inlined in one Server Action.
 * Adding a second call site over HTTP would have meant two definitions of a
 * security boundary, and the two would drift. This module is now the only one.
 *
 * WHAT IS TRUSTED, AND WHAT IS NOT
 * --------------------------------
 * Only the header Vercel sets at its own edge is read:
 * `x-vercel-forwarded-for`. A client-provided `x-forwarded-for`, `x-real-ip`,
 * `forwarded`, `true-client-ip` or `cf-connecting-ip` is ignored entirely.
 * Those are ordinary request headers: on any other host, or if the edge ever
 * stopped overwriting them, they are attacker-controlled, and a rate limiter fed
 * attacker-controlled keys is a rate limiter an attacker can turn off.
 *
 * HONEST LIMITATION, RECORDED RATHER THAN GLOSSED
 * -----------------------------------------------
 * Vercel's documentation pages are client-rendered and could not be read back in
 * the session that wrote this module, so the edge-overwrite property is *not*
 * re-verified here. What is known: the project's October 2026 hardening audit
 * accepted this header, and production traffic has always arrived with it. This
 * is therefore a **platform-specific, tracked assumption**, not a proven
 * invariant. If it is ever wrong, the resolver fails closed (no IP, request
 * rejected) rather than silently trusting a spoofable value — and the database
 * limiter, the duplicate constraint, and the per-event semantics still hold.
 *
 * NEVER accept an IP from a request body. Only this module may decide.
 */

/** The only header trusted as the client address. */
export const VERCEL_CLIENT_IP_HEADER = "x-vercel-forwarded-for";

/** Development only: every local request shares one rate-limit bucket. */
export const LOCAL_DEVELOPMENT_IP = "127.0.0.1";

/** Headers that are deliberately NOT trusted, named so tests can prove it. */
export const IGNORED_IP_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "true-client-ip",
  "cf-connecting-ip",
  "fastly-client-ip",
  "x-client-ip",
] as const;

export type ClientIpSource =
  "vercel-edge" | "local-development" | "explicit-test";

export type ClientIpResolution =
  | { ok: true; ip: string; source: ClientIpSource }
  | { ok: false; reason: "missing" | "malformed" | "not-vercel" };

/**
 * Normalize a candidate address to the bare IP literal.
 *
 * Vercel hands back a bare address, but the same helper is used for test and
 * local values, and it is better to accept the two common decorated forms than
 * to reject a legitimate request:
 *   `203.0.113.7:4432`      → `203.0.113.7`   (IPv4 with port)
 *   `[2001:db8::1]:443`     → `2001:db8::1`  (bracketed IPv6 with port)
 *
 * Anything else that `net.isIP` does not recognise returns `null`, so garbage
 * can never reach the database limiter.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let candidate = value.trim();
  if (candidate.length === 0) return null;
  // A forwarded list must never be collapsed into one made-up address.
  if (candidate.includes(",")) return null;

  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end === -1) return null;
    const inner = candidate.slice(1, end);
    const rest = candidate.slice(end + 1);
    if (rest !== "" && !/^:\d+$/.test(rest)) return null;
    candidate = inner;
  } else if (isIP(candidate) === 0) {
    const match = /^([^:]+):(\d+)$/.exec(candidate);
    if (!match) return null;
    candidate = match[1];
  }

  return isIP(candidate) === 0 ? null : candidate;
}

/**
 * Resolve the client address for a request.
 *
 * The caller supplies request headers only. There is deliberately no parameter
 * for a body, a query string, or an "override", so that a public route cannot
 * pass one through even by mistake.
 */
export function resolveClientIp(
  headers: Headers,
  options: { environment?: string } = {}
): ClientIpResolution {
  const environment = options.environment ?? process.env.NODE_ENV;
  const raw = headers.get(VERCEL_CLIENT_IP_HEADER);

  if (raw === null) {
    // Local development has no edge in front of it. Every local request shares
    // one bucket, which is fine: the limiter only matters behind a real proxy.
    if (environment === "development" || environment === "test") {
      return {
        ok: true,
        ip: LOCAL_DEVELOPMENT_IP,
        source: "local-development",
      };
    }
    return { ok: false, reason: "missing" };
  }

  const ip = normalizeIp(raw);
  if (!ip) return { ok: false, reason: "malformed" };
  return { ok: true, ip, source: "vercel-edge" };
}
