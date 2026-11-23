import { getManagerContext } from "@/lib/auth/manager";
import { canReviewMembership } from "@/lib/membership/server";
import { readSquDocument } from "@/lib/verification/review";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * SQU student verification evidence, for a membership reviewer only (ADR 0025).
 * There is no storage URL anywhere: each view is this authenticated request,
 * the routine re-checks the reviewer's live access (and that it is not their
 * own request) and records the view in audit. The response is never cached.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const [{ id }, manager] = await Promise.all([
    context.params,
    getManagerContext(),
  ]);
  const deny = (status: number) =>
    new Response(null, { status, headers: { "cache-control": "no-store" } });
  if (manager.kind !== "manager") return deny(401);
  if (!UUID.test(id)) return deny(404);
  try {
    if (!(await canReviewMembership(manager.userId))) return deny(403);
    const document = await readSquDocument(manager.userId, id);
    // Removed by retention, the reviewer's own request, or unknown: one answer.
    if (!document) return deny(404);
    return new Response(new Uint8Array(document.content), {
      status: 200,
      headers: {
        // The type was established from the file's own signature at upload.
        "content-type": document.mediaType,
        "content-length": String(document.content.byteLength),
        "content-disposition": `inline; filename="squ-verification.${EXTENSIONS[document.mediaType] ?? "bin"}"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        // A document never runs anything or loads anything else.
        "content-security-policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      },
    });
  } catch {
    return deny(503);
  }
}
