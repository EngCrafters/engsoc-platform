import {
  membershipOptions,
  submitMembershipApplication,
  validateApplication,
  type RawApplication,
} from "@/lib/membership";
import { resolveClientIp } from "@/lib/client-ip/server";
import { corsHeaders, isAllowedOrigin, preflight } from "@/lib/api/cors";
import { logServerError } from "@/lib/api/log";
import {
  json,
  problem,
  readMultipartBody,
  requestIdFrom,
} from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * UC-01 membership application (ADRs 0017 and 0025). Public, like event
 * registration: no API key, no cookie, exact-origin CORS, per-IP rate limit in
 * the database. The applicant sends the website's form fields; the category
 * decides which details apply, and Core validates every field before the
 * database validates it again. No document is uploaded here (SQU student
 * verification is a separate, signed-in flow). Nothing sent here can choose a
 * status, role or reviewer: under the automatic policy (ADR 0029) the database
 * approves a valid application itself, and `status` reports that.
 */

const NO_STORE = "no-store";
const SCALAR_FIELDS = [
  "fullName",
  "email",
  "category",
  "institution",
  "institutionName",
  "academicYear",
  "discipline",
  "consent",
  "consentVersion",
] as const;
/**
 * The previous website's SQU-only form, accepted for one release (ADR 0025):
 * it is treated as a University Student at SQU, and its student ID and ID card
 * are read only to be discarded, never stored.
 */
const LEGACY_FIELDS = ["universityId", "idDocument"] as const;
const ALLOWED_KEYS = new Set<string>([
  ...SCALAR_FIELDS,
  ...LEGACY_FIELDS,
  "interests",
]);

export function OPTIONS(request: Request): Response {
  return preflight(request, requestIdFrom(request));
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);
  if (origin !== null && !isAllowedOrigin(origin)) {
    return problem("forbidden", requestId, { headers: cors });
  }

  const body = await readMultipartBody(request);
  if (!body.ok) return problem(body.reason, requestId, { headers: cors });
  const form = body.form;

  const unexpected = [...new Set(form.keys())].filter(
    (key) => !ALLOWED_KEYS.has(key)
  );
  if (unexpected.length > 0) {
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors: unexpected.map((field) => ({ field, code: "unexpected-field" })),
    });
  }

  // Each scalar is one text value; a repeated or file-typed scalar is malformed.
  const scalar = (key: (typeof SCALAR_FIELDS)[number]) => {
    const values = form.getAll(key);
    if (values.length === 0) return { value: null, bad: false };
    if (values.length > 1 || typeof values[0] !== "string")
      return { value: null, bad: true };
    return { value: values[0] as string, bad: false };
  };
  const malformed: string[] = SCALAR_FIELDS.filter((key) => scalar(key).bad);
  const interestValues = form.getAll("interests");
  if (interestValues.some((value) => typeof value !== "string"))
    malformed.push("interests");
  if (malformed.length > 0) {
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors: malformed.map((field) => ({ field, code: "invalid" })),
    });
  }

  const legacy =
    !form.has("category") && LEGACY_FIELDS.some((key) => form.has(key));
  const raw: RawApplication = {
    fullName: scalar("fullName").value,
    email: scalar("email").value,
    category: legacy ? "university_student" : scalar("category").value,
    institution: legacy ? "squ" : scalar("institution").value,
    institutionName: legacy ? null : scalar("institutionName").value,
    academicYear: scalar("academicYear").value,
    discipline: scalar("discipline").value,
    interests: interestValues as string[],
    consent: scalar("consent").value,
    consentVersion: scalar("consentVersion").value,
  };
  let options;
  try {
    options = await membershipOptions();
  } catch (error) {
    logServerError("membership_options_failed", error, requestId);
    return problem("service-unavailable", requestId, { headers: cors });
  }
  const validation = validateApplication(raw, options);
  if (!validation.ok) {
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors: validation.errors,
    });
  }

  const ip = resolveClientIp(request.headers);
  if (!ip.ok) {
    // No trustworthy client address means no trustworthy rate-limit key.
    return problem("service-unavailable", requestId, { headers: cors });
  }

  const result = await submitMembershipApplication(validation.value, ip.ip);
  if (result.ok) {
    return json(
      {
        data: {
          status: result.status,
          statusToken: result.statusToken,
          accountActivation: result.accountActivation,
        },
      },
      { status: 201, requestId, cacheControl: NO_STORE, headers: cors }
    );
  }
  switch (result.error) {
    case "invalid_field":
      return problem("invalid-fields", requestId, {
        headers: cors,
        errors: result.field
          ? [{ field: result.field, code: "invalid" }]
          : undefined,
      });
    case "already_applied":
      return problem("conflict", requestId, {
        headers: cors,
        reason: "already-applied",
      });
    case "already_member":
      return problem("conflict", requestId, {
        headers: cors,
        reason: "already-member",
      });
    case "rate_limited":
      // The limiter's window is an hour, so that is the honest retry hint.
      return problem("rate-limited", requestId, {
        headers: { ...cors, "retry-after": "3600" },
      });
    default:
      return problem("service-unavailable", requestId, { headers: cors });
  }
}
