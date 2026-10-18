import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * API client authentication for the event-read endpoints (ADR 0016).
 *
 * A token looks like `essq_live_<prefix>_<secret>` or `essq_test_<prefix>_<secret>`.
 * Only the prefix and a SHA-256 hash of the whole token are ever stored, so a
 * database leak does not yield usable credentials.
 *
 * The verification itself is a single `private.verify_api_client` call. Every
 * condition that can invalidate a client — active flag, revocation, expiry,
 * environment, required scope — is enforced inside that routine, so a caller
 * cannot skip a check by not implementing it.
 */

export const EVENTS_READ_SCOPE = "events:read";

const TOKEN_PATTERN =
  /^essq_(live|test)_([a-z0-9_]{8,40})_([A-Za-z0-9_-]{32,})$/;

export type ApiClient = { id: string; name: string };

export type ApiAuthResult =
  | { ok: true; client: ApiClient }
  | { ok: false; reason: "unauthorized" | "forbidden" | "service-unavailable" };

/** SHA-256 of the full token, hex encoded. This is what the database stores. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

type ParsedToken = { prefix: string; hash: string; environment: string };

/**
 * Parse a token without touching the database.
 *
 * Returns `null` for anything that is not exactly the documented shape, so a
 * malformed Authorization header never costs a query.
 */
export function parseToken(token: string): ParsedToken | null {
  const match = TOKEN_PATTERN.exec(token.trim());
  if (!match) return null;
  return {
    prefix: match[2],
    hash: hashToken(token.trim()),
    environment: match[1] === "live" ? "production" : "staging",
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Authenticate a request for a scope.
 *
 * Fails closed: missing or malformed tokens, unknown prefixes, wrong hashes,
 * inactive, expired or revoked clients, and wrong environments all return
 * unauthorized without identifying which credential check failed. A valid
 * active credential missing the required scope returns forbidden. Registry
 * failures return service-unavailable.
 */
export async function authenticate(
  request: Request,
  requiredScope: string = EVENTS_READ_SCOPE
): Promise<ApiAuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, reason: "unauthorized" };

  const parsed = parseToken(token);
  if (!parsed) return { ok: false, reason: "unauthorized" };

  try {
    const rows = await db.execute<{
      client_id: string;
      client_name: string;
      has_scope: boolean;
    }>(sql`
      select client_id, client_name, has_scope
      from private.verify_api_client(
        ${parsed.prefix},
        ${parsed.hash},
        ${requiredScope},
        ${parsed.environment}
      )
    `);

    const row = rows[0];
    if (!row) {
      // Unknown prefix, wrong hash, inactive, revoked or expired. All of these
      // are "this credential is not valid", and they stay indistinguishable so
      // the response cannot be used to enumerate tokens.
      return { ok: false, reason: "unauthorized" };
    }
    if (!row.has_scope) {
      // A valid credential that simply is not allowed to do this. 403 is the
      // truth; collapsing it into 401 would send an integrator hunting for a key
      // problem that does not exist.
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, client: { id: row.client_id, name: row.client_name } };
  } catch {
    // The database is unreachable. Say so, rather than pretending the caller is
    // unauthenticated — that would send an integrator hunting a key problem that
    // does not exist.
    return { ok: false, reason: "service-unavailable" };
  }
}
