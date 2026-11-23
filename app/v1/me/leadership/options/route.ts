import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { problem } from "@/lib/api/http";
import { leadershipOptions, naming } from "@/lib/verification/member";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

/**
 * What a member may request (ADR 0025): active committees with their active teams, and the
 * requestable positions, with English and Arabic names.
 */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    return memberResult(
      naming(await leadershipOptions(auth.actor!), "leadership"),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("leadership_options_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
