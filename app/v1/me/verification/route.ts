import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { problem } from "@/lib/api/http";
import { naming, ownSquVerification } from "@/lib/verification/member";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

/**
 * The signed-in member's SQU student verification (ADR 0025): status, the
 * member-facing reasons and whether they may submit now. Committee leadership
 * is a separate endpoint (`/v1/me/leadership`), so either can fail without
 * hiding the other. Only the member's own data; never a reviewer note or the
 * full student number.
 */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    return memberResult(
      naming(await ownSquVerification(auth.actor!), "verification"),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_verification_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
