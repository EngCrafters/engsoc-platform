import {
  submitMembershipApplication,
  validateApplication,
  type RawApplication,
} from "@/lib/membership";
import { resolveClientIp } from "@/lib/client-ip/server";
import { corsHeaders, isAllowedOrigin, preflight } from "@/lib/api/cors";
import {
  json,
  problem,
  readMultipartBody,
  requestIdFrom,
} from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * UC-01 membership application (ADR 0017). Public, like event registration:
 * no API key, no cookie, exact-origin CORS, per-IP rate limit in the database.
 * The applicant sends the website's form fields and one SQU ID card file; Core
 * validates every field and the file's content, and stores the application as
 * `pending_review`. Nothing sent here can choose a status, role or reviewer.
 */

const NO_STORE = "no-store";
const SCALAR_FIELDS = [
  "fullName",
  "email",
  "universityId",
  "academicYear",
  "discipline",
  "consent",
  "consentVersion",
] as const;
const ALLOWED_KEYS = new Set<string>([
  ...SCALAR_FIELDS,
  "interests",
  "idDocument",
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
  const documents = form.getAll("idDocument");
  if (interestValues.some((value) => typeof value !== "string"))
    malformed.push("interests");
  if (
    documents.length > 1 ||
    (documents.length === 1 && typeof documents[0] === "string")
  )
    malformed.push("idDocument");
  if (malformed.length > 0) {
    return problem("invalid-fields", requestId, {
      headers: cors,
      errors: malformed.map((field) => ({ field, code: "invalid" })),
    });
  }

  const file = documents[0] as File | undefined;
  const raw: RawApplication = {
    fullName: scalar("fullName").value,
    email: scalar("email").value,
    universityId: scalar("universityId").value,
    academicYear: scalar("academicYear").value,
    discipline: scalar("discipline").value,
    interests: interestValues as string[],
    consent: scalar("consent").value,
    consentVersion: scalar("consentVersion").value,
    document: file ? new Uint8Array(await file.arrayBuffer()) : null,
  };
  const validation = validateApplication(raw);
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
      { data: { status: "pending_review", statusToken: result.statusToken } },
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
