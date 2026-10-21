import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { memberFeatures, requestProfileChange } from "@/lib/members/profile";
import { problem, readJsonBody } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

/**
 * A correction to a verified field (name or student ID), decided by a membership reviewer
 * against the member's SQU ID card (ADR 0023). The member never changes these directly.
 */
export async function POST(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok)
    return problem(body.reason, auth.requestId!, { headers: auth.cors });
  const value = body.value as Record<string, unknown> | null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => k !== "field" && k !== "value") ||
    !["full_name", "university_id"].includes(String(value.field)) ||
    typeof value.value !== "string" ||
    value.value.length > 200
  )
    return memberResult(
      { code: "VALIDATION_ERROR", field: "value" },
      auth.requestId!,
      auth.cors!
    );
  try {
    const result = await requestProfileChange(
      auth.actor!,
      value.field as "full_name" | "university_id",
      value.value
    );
    return memberResult(
      result.code === "SUCCESS"
        ? { ...result, features: memberFeatures() }
        : result,
      auth.requestId!,
      auth.cors!,
      201
    );
  } catch (error) {
    logServerError("member_change_request_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
