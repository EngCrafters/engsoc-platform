import "server-only";

/**
 * RFC 9457 problem details, with a stable public error vocabulary.
 *
 * Two rules make this module worth having rather than inlining JSON:
 *
 *  1. Internal domain codes are never echoed to the public. `register_for_event`
 *     speaks in EVENT_FULL / ALREADY_REGISTERED / RATE_LIMITED; the browser gets
 *     a fixed public code and a fixed title. A change inside the database cannot
 *     change the public contract by accident.
 *  2. Nothing that describes the inside of the system leaks. No SQL, no
 *     function name, no stack, no provider message, no token, no email, no IP.
 */

export const PROBLEM_BASE = "https://api.essqu.com/problems";

/** The complete public error vocabulary for v1. Never remove a member. */
export const PUBLIC_ERROR_CODES = [
  "bad-request",
  "unsupported-media-type",
  "payload-too-large",
  "invalid-fields",
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "rate-limited",
  "service-unavailable",
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/** Optional public detail for registration conflicts; never an internal code. */
export const REGISTRATION_CONFLICT_REASONS = [
  "already-registered",
  "already-waitlisted",
  "event-full",
  "registration-closed",
  "registration-available",
] as const;
export type RegistrationConflictReason =
  (typeof REGISTRATION_CONFLICT_REASONS)[number];

type ProblemSpec = { status: number; title: string; type: string };

const SPECS: Record<PublicErrorCode, ProblemSpec> = {
  "bad-request": { status: 400, title: "Bad Request", type: "bad-request" },
  "unsupported-media-type": {
    status: 415,
    title: "Unsupported Media Type",
    type: "unsupported-media-type",
  },
  "payload-too-large": {
    status: 413,
    title: "Payload Too Large",
    type: "payload-too-large",
  },
  "invalid-fields": {
    status: 422,
    title: "Unprocessable Content",
    type: "invalid-fields",
  },
  unauthorized: { status: 401, title: "Unauthorized", type: "unauthorized" },
  forbidden: { status: 403, title: "Forbidden", type: "forbidden" },
  "not-found": { status: 404, title: "Not Found", type: "not-found" },
  conflict: { status: 409, title: "Conflict", type: "conflict" },
  "rate-limited": {
    status: 429,
    title: "Too Many Requests",
    type: "rate-limited",
  },
  "service-unavailable": {
    status: 503,
    title: "Service Unavailable",
    type: "service-unavailable",
  },
};

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  code: PublicErrorCode;
  requestId: string;
  reason?: RegistrationConflictReason;
  /** Field-level detail for validation failures only. */
  errors?: { field: string; code: string }[];
};

/**
 * Build a problem response.
 *
 * `headers` carries CORS and, for 401, `WWW-Authenticate`. The body is built
 * from the fixed spec table, so a caller cannot inject text.
 */
export function problem(
  code: PublicErrorCode,
  requestId: string,
  options: {
    errors?: { field: string; code: string }[];
    headers?: Record<string, string>;
    reason?: RegistrationConflictReason;
  } = {}
): Response {
  const spec = SPECS[code];
  const body: ProblemBody = {
    type: PROBLEM_BASE + "/" + spec.type,
    title: spec.title,
    status: spec.status,
    code,
    requestId,
  };
  if (options.errors?.length) body.errors = options.errors;
  if (code === "conflict" && options.reason) body.reason = options.reason;

  const headers: Record<string, string> = {
    "content-type": "application/problem+json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-request-id": requestId,
    ...(options.headers ?? {}),
  };
  if (spec.status === 401) headers["www-authenticate"] = "Bearer";

  return new Response(JSON.stringify(body), { status: spec.status, headers });
}
