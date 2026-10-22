import { json, problem, requestIdFrom } from "@/lib/api/http";
import { logServerError } from "@/lib/api/log";
import {
  databaseSchemaVersion,
  REQUIRED_SCHEMA_VERSION,
} from "@/lib/db/schema-version";

export const dynamic = "force-dynamic";

/**
 * For smoke tests and monitors: the database answers and is at least as new
 * as this code. No version numbers or configuration are disclosed.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const version = await databaseSchemaVersion();
    const compatible = version >= REQUIRED_SCHEMA_VERSION;
    if (!compatible)
      console.error("schema_behind", {
        requestId,
        required: REQUIRED_SCHEMA_VERSION,
        actual: version,
      });
    return json(
      { data: { status: compatible ? "ok" : "schema-behind" } },
      { status: compatible ? 200 : 503, requestId, cacheControl: "no-store" }
    );
  } catch (error) {
    logServerError("health_check_failed", error, requestId);
    return problem("service-unavailable", requestId);
  }
}
