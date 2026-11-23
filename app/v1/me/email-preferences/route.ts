import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { problem, readJsonBody } from "@/lib/api/http";
import {
  ownEmailPreferences,
  setOwnEmailPreferences,
} from "@/lib/email/server";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

/**
 * The signed-in member's email choices (ADR 0028): `{announcements}`, whether they receive the
 * society's optional announcements from the Email Centre. No row means subscribed.
 */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    return memberResult(
      await ownEmailPreferences(auth.actor!),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_email_preferences_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}

/** `{announcements: boolean}`. Audited. */
export async function PATCH(request: Request) {
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
    Object.keys(value).some((key) => key !== "announcements") ||
    typeof value.announcements !== "boolean"
  )
    return memberResult(
      { code: "VALIDATION_ERROR", field: "announcements" },
      auth.requestId!,
      auth.cors!
    );
  try {
    return memberResult(
      await setOwnEmailPreferences(auth.actor!, value.announcements),
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_email_preferences_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
