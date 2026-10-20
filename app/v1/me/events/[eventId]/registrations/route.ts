import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { registerMember } from "@/lib/event-management/server";
import { isUuid } from "@/lib/admin-events/types";
import { resolveClientIp } from "@/lib/client-ip/server";
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
  const ip = resolveClientIp(request.headers);
  if (!ip.ok)
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  try {
    const result = await registerMember(
      auth.actor!,
      eventId,
      String(value.intent),
      ip.ip
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
  } catch {
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
