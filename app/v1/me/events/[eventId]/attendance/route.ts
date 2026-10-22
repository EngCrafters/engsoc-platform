import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { confirmAttendance, memberEvent } from "@/lib/event-management/server";
import { isUuid } from "@/lib/admin-events/types";
import { problem, readJsonBody } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;
type Context = { params: Promise<{ eventId: string }> };
export async function GET(request: Request, { params }: Context) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const { eventId } = await params;
  if (!isUuid(eventId))
    return problem("not-found", auth.requestId!, { headers: auth.cors });
  try {
    return memberResult(
      await memberEvent(auth.actor!, eventId),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_attendance_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
export async function POST(request: Request, { params }: Context) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const { eventId } = await params;
  if (!isUuid(eventId))
    return problem("not-found", auth.requestId!, { headers: auth.cors });
  const body = await readJsonBody(request);
  if (!body.ok)
    return problem(body.reason, auth.requestId!, { headers: auth.cors });
  const value = body.value as Record<string, unknown> | null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => k !== "challenge") ||
    typeof value.challenge !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.challenge)
  )
    return memberResult(
      { code: "INVALID_CHALLENGE" },
      auth.requestId!,
      auth.cors!
    );
  try {
    return memberResult(
      await confirmAttendance(auth.actor!, eventId, value.challenge),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_attendance_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
