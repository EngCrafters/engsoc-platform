import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { updatePhone } from "@/lib/event-management/server";
import { normalizePhone } from "@/lib/event-management/phone";
import {
  DISCIPLINES,
  INTERESTS,
  memberFeatures,
  ownProfile,
  updateOwnProfile,
} from "@/lib/members/profile";
import { problem, readJsonBody } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;
const EDITABLE = ["phone", "academicYear", "discipline", "interests"];

/** The signed-in member's whole profile, and which profile features Core allows (ADR 0023). */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    const profile = await ownProfile(auth.actor!);
    return memberResult(
      profile.code === "SUCCESS"
        ? { ...profile, features: memberFeatures() }
        : profile,
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_profile_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}

/**
 * `{phone}` alone is the event-registration prompt (ADR 0020) and always available. Otherwise
 * the full set of self-service fields, when profile editing is enabled. Name, email and student
 * ID are never accepted here: they change only through a reviewed correction.
 */
export async function PATCH(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok)
    return problem(body.reason, auth.requestId!, { headers: auth.cors });
  const value = body.value as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return memberResult(
      { code: "VALIDATION_ERROR", field: "profile" },
      auth.requestId!,
      auth.cors!
    );
  const keys = Object.keys(value);
  try {
    if (keys.length === 1 && keys[0] === "phone") {
      const phone =
        typeof value.phone === "string" ? normalizePhone(value.phone) : null;
      if (!phone)
        return memberResult(
          { code: "PHONE_REQUIRED" },
          auth.requestId!,
          auth.cors!
        );
      return memberResult(
        await updatePhone(auth.actor!, phone),
        auth.requestId!,
        auth.cors!
      );
    }
    if (!memberFeatures().profileEditing)
      return problem("forbidden", auth.requestId!, {
        headers: auth.cors,
        errors: [{ field: "profile", code: "EDITING_DISABLED" }],
      });
    const invalid = (field: string) =>
      memberResult(
        { code: "VALIDATION_ERROR", field },
        auth.requestId!,
        auth.cors!
      );
    if (
      keys.length !== EDITABLE.length ||
      !EDITABLE.every((k) => keys.includes(k))
    )
      return invalid("profile");
    const phone =
      value.phone === null || value.phone === ""
        ? null
        : typeof value.phone === "string"
          ? normalizePhone(value.phone)
          : undefined;
    if (phone === undefined || (value.phone && phone === null))
      return invalid("phone");
    const year = value.academicYear;
    if (!Number.isInteger(year) || (year as number) < 1 || (year as number) > 5)
      return invalid("academicYear");
    if (!DISCIPLINES.includes(value.discipline as (typeof DISCIPLINES)[number]))
      return invalid("discipline");
    const interests = value.interests;
    if (
      !Array.isArray(interests) ||
      interests.length > 4 ||
      new Set(interests).size !== interests.length ||
      !interests.every((i) =>
        INTERESTS.includes(i as (typeof INTERESTS)[number])
      )
    )
      return invalid("interests");
    const saved = await updateOwnProfile(auth.actor!, {
      phone,
      academicYear: year as number,
      discipline: value.discipline as string,
      interests: interests as string[],
    });
    return memberResult(
      saved.code === "SUCCESS"
        ? { ...saved, features: memberFeatures() }
        : saved,
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_profile_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
