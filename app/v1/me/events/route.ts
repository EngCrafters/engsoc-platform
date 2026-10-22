import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { ownRegistrations } from "@/lib/members/profile";
import { problem } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

/** The signed-in member's own event registrations, newest event first (ADR 0023). */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    return memberResult(
      await ownRegistrations(auth.actor!),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_events_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
