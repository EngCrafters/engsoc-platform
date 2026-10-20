import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { memberProfile, updatePhone } from "@/lib/event-management/server";
import { normalizePhone } from "@/lib/event-management/phone";
import { problem, readJsonBody } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    return memberResult(
      await memberProfile(auth.actor!),
      auth.requestId!,
      auth.cors!
    );
  } catch {
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
export async function PATCH(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok)
    return problem(body.reason, auth.requestId!, { headers: auth.cors });
  const value = body.value as Record<string, unknown> | null;
  const phone =
    value && typeof value.phone === "string"
      ? normalizePhone(value.phone)
      : null;
  if (
    !phone ||
    !value ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => k !== "phone")
  )
    return memberResult(
      { code: "PHONE_REQUIRED" },
      auth.requestId!,
      auth.cors!
    );
  try {
    return memberResult(
      await updatePhone(auth.actor!, phone),
      auth.requestId!,
      auth.cors!
    );
  } catch {
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
