import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { registerMember } from "@/lib/event-management/server";
import { isUuid } from "@/lib/admin-events/types";
import { json, problem, readJsonBody } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
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
    Object.keys(value).some((k) => k !== "intent") ||
    !["register", "join_waitlist"].includes(String(value.intent))
  )
    return memberResult(
      { code: "VALIDATION_ERROR" },
      auth.requestId!,
      auth.cors!
    );
  // Signed-in registrations are limited per member (ADR 0022), so the client
  // address is not needed: a shared campus network never blocks a member.
  try {
    const result = await registerMember(
      auth.actor!,
      eventId,
      String(value.intent)
    );
    if (["SUCCESS", "WAITLISTED"].includes(result.code))
      return json(
        {
          data: {
            status: result.code === "SUCCESS" ? "confirmed" : "waitlisted",
          },
        },
        {
          status: 201,
          requestId: auth.requestId!,
          cacheControl: "no-store",
          headers: auth.cors,
        }
      );
    return memberResult(result, auth.requestId!, auth.cors!);
  } catch (error) {
    logServerError("member_registration_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
