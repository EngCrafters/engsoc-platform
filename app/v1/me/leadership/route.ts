import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { problem } from "@/lib/api/http";
import { naming, ownLeadership } from "@/lib/verification/member";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

/**
 * The signed-in member's committee leadership (ADR 0025): appointments,
 * requests with their member-facing reasons, the request limit and whether
 * they have dashboard access, with each active appointment's `grantsAccess` (ADR 0027). SQU
 * verification is a separate endpoint (`/v1/me/verification`). Never a
 * reviewer note or a reviewer's identity.
 */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    return memberResult(
      naming(await ownLeadership(auth.actor!), "leadership"),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_leadership_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
