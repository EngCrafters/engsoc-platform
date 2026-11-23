import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { problem, readJsonBody } from "@/lib/api/http";
import { naming, requestLeadership } from "@/lib/verification/member";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITION = /^[a-z][a-z_]{1,39}$/;

/**
 * A request for a leadership position (ADRs 0025 and 0026): `{committeeId, teamId?, position}`.
 * Without a team (absent or null) it is committee-level leadership; with one, team leadership.
 * The database checks that requests are open, that the committee is active, that the team (if
 * any) belongs to it and is active, that the position is requestable, and the member's pending
 * and recent requests. A request grants nothing until a leadership reviewer approves it; an
 * appointment then gives only the dashboard permissions assigned to its committee or team (ADR 0027).
 */
export async function POST(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok)
    return problem(body.reason, auth.requestId!, { headers: auth.cors });
  const value = body.value as Record<string, unknown> | null;
  const invalid = (field: string) =>
    memberResult(
      { code: "VALIDATION_ERROR", field },
      auth.requestId!,
      auth.cors!
    );
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["committeeId", "teamId", "position"].includes(key)
    )
  )
    return invalid("leadership");
  if (typeof value.committeeId !== "string" || !UUID.test(value.committeeId))
    return invalid("committee");
  // ADR 0026: no team (absent or null) is committee-level leadership.
  const teamId = value.teamId ?? null;
  if (teamId !== null && (typeof teamId !== "string" || !UUID.test(teamId)))
    return invalid("team");
  if (typeof value.position !== "string" || !POSITION.test(value.position))
    return invalid("position");
  try {
    const result = await requestLeadership(
      auth.actor!,
      value.committeeId,
      teamId,
      value.position
    );
    return memberResult(
      naming(result, "leadership"),
      auth.requestId!,
      auth.cors!,
      201
    );
  } catch (error) {
    logServerError("leadership_request_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
