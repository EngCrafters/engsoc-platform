import "server-only";

import { randomUUID } from "node:crypto";
import { problem } from "./problems";

/**
 * Request identity, bounded body reading, and success responses.
 *
 * Kept together because they are the three things every route needs and each is
 * easy to get subtly wrong.
 */

/** Public routes accept at most 16 KiB of JSON. */
export const MAX_BODY_BYTES = 16 * 1024;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Every request gets an id.
 *
 * A caller may supply one for correlation, but only if it is short and made of
 * safe characters — otherwise it is replaced. A caller-supplied value becomes a
 * log token, so it must not be able to carry newlines or arbitrary length.
 */
export function requestIdFrom(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  if (supplied && REQUEST_ID_PATTERN.test(supplied)) return supplied;
  return randomUUID();
}

export type BodyResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason: "unsupported-media-type" | "payload-too-large" | "bad-request";
    };

/**
 * Read a JSON body with a hard size bound.
 *
 * `Content-Length` is checked first so an oversized request is rejected without
 * being buffered, but it is not trusted: the stream is also counted, so a
 * missing or false length cannot bypass the limit. Only `application/json` is
 * accepted; a form post or a text/plain "simple request" is refused, which also
 * blocks the classic CORS-bypass trick of posting JSON as text/plain.
 */
export async function readJsonBody(request: Request): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return { ok: false, reason: "unsupported-media-type" };
  }

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      return { ok: false, reason: "bad-request" };
    }
    if (length > MAX_BODY_BYTES)
      return { ok: false, reason: "payload-too-large" };
  }

  if (!request.body) return { ok: false, reason: "bad-request" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "payload-too-large" };
    }
    chunks.push(value);
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks)
    );
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "bad-request" };
  }
}

/**
 * Membership applications carry one ID-card file (≤ 4 MiB) plus a few short
 * fields. 4.5 MB is also Vercel's request-body ceiling, so anything larger
 * would never reach the function in production anyway.
 */
export const MAX_MULTIPART_BYTES = 4_500_000;

export type MultipartResult =
  | { ok: true; form: FormData }
  | {
      ok: false;
      reason: "unsupported-media-type" | "payload-too-large" | "bad-request";
    };

/**
 * Read a `multipart/form-data` body with the same hard bound as JSON bodies:
 * `Content-Length` is checked first but not trusted, and the stream itself is
 * counted, so a missing or false length cannot make the server buffer more.
 * Parsing happens only on the bounded bytes.
 */
export async function readMultipartBody(
  request: Request,
  maxBytes: number = MAX_MULTIPART_BYTES
): Promise<MultipartResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) {
    return { ok: false, reason: "unsupported-media-type" };
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      return { ok: false, reason: "bad-request" };
    }
    if (length > maxBytes) return { ok: false, reason: "payload-too-large" };
  }
  if (!request.body) return { ok: false, reason: "bad-request" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "payload-too-large" };
    }
    chunks.push(value);
  }

  try {
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": contentType },
    }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, reason: "bad-request" };
  }
}

/** A successful JSON response with the shared safety headers. */
export function json(
  body: unknown,
  options: {
    status?: number;
    requestId: string;
    cacheControl: string;
    headers?: Record<string, string>;
  }
): Response {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": options.cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-request-id": options.requestId,
      ...(options.headers ?? {}),
    },
  });
}

export { problem };
