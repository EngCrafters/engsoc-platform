import { logServerError } from "@/lib/api/log";
import {
  memberPreflight,
  memberRequest,
  memberResult,
} from "@/lib/event-management/api";
import { problem, readMultipartBody } from "@/lib/api/http";
import { checkDocument } from "@/lib/membership/document";
import {
  STUDENT_NUMBER,
  naming,
  submitSquVerification,
} from "@/lib/verification/member";
export const dynamic = "force-dynamic";
export const OPTIONS = memberPreflight;

const ALLOWED_KEYS = new Set(["studentNumber", "document"]);

/**
 * SQU student verification evidence (ADR 0025): the student number and one image or PDF of the
 * SQU student ID card, from a signed-in member. The file is judged by its content (JPEG, PNG,
 * WebP or PDF, at most 4 MiB, no active PDF content) and stored privately; a membership reviewer
 * decides. Verification is optional and changes nothing about membership.
 */
export async function POST(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const headers = auth.cors!;
  const body = await readMultipartBody(request);
  if (!body.ok)
    return problem(body.reason, auth.requestId!, {
      headers,
      ...(body.reason === "payload-too-large"
        ? { errors: [{ field: "document", code: "too-large" }] }
        : {}),
    });
  const form = body.form;
  const unexpected = [...new Set(form.keys())].filter(
    (key) => !ALLOWED_KEYS.has(key)
  );
  const numbers = form.getAll("studentNumber");
  const documents = form.getAll("document");
  const studentNumber =
    numbers.length === 1 && typeof numbers[0] === "string"
      ? numbers[0].trim()
      : null;
  const file =
    documents.length === 1 && typeof documents[0] !== "string"
      ? (documents[0] as File)
      : null;
  const errors: { field: string; code: string }[] = unexpected.map((field) => ({
    field,
    code: "unexpected-field",
  }));
  if (!studentNumber) errors.push({ field: "studentNumber", code: "required" });
  else if (!STUDENT_NUMBER.test(studentNumber))
    errors.push({ field: "studentNumber", code: "invalid" });
  const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
  const document = checkDocument(bytes);
  if (!document.ok) errors.push({ field: "document", code: document.code });
  if (errors.length > 0 || !document.ok || !studentNumber || !bytes)
    return problem("invalid-fields", auth.requestId!, { headers, errors });
  try {
    const result = await submitSquVerification(auth.actor!, {
      studentNumber,
      document: { mediaType: document.mediaType, bytes },
    });
    return memberResult(naming(result, "squ"), auth.requestId!, headers, 201);
  } catch (error) {
    logServerError("squ_verification_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, { headers });
  }
}
