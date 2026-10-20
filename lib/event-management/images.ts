import "server-only";

import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  documentStorageMode,
  signRequest,
  EMPTY_PAYLOAD_SHA256,
} from "@/lib/membership/storage";

export const MAX_COVER_BYTES = 3 * 1024 * 1024;
const KEY = /^event-covers\/[0-9a-f-]{36}\.(jpg|png)$/;

export function eventStorage() {
  const mode = documentStorageMode({
    ...process.env,
    SUPABASE_S3_MEMBERSHIP_BUCKET: process.env.SUPABASE_S3_EVENT_BUCKET,
  });
  if (
    mode.mode !== "storage" ||
    mode.config.bucket === process.env.SUPABASE_S3_MEMBERSHIP_BUCKET
  ) {
    throw new Error("Event image storage is not configured");
  }
  return mode.config;
}

export async function prepareCover(file: File) {
  if (
    !file.size ||
    file.size > MAX_COVER_BYTES ||
    !["image/jpeg", "image/png"].includes(file.type)
  )
    throw new Error("INVALID_IMAGE");
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = file.type === "image/png";
  const signature = png
    ? bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!signature) throw new Error("INVALID_IMAGE");
  const image = sharp(bytes, {
    limitInputPixels: 20_000_000,
    animated: false,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if ((png ? "png" : "jpeg") !== metadata.format || (metadata.pages ?? 1) > 1)
    throw new Error("INVALID_IMAGE");
  const output = await image.rotate().resize({
    width: 2400,
    height: 2400,
    fit: "inside",
    withoutEnlargement: true,
  });
  const clean = await (
    png ? output.png() : output.jpeg({ quality: 88 })
  ).toBuffer();
  if (clean.length > MAX_COVER_BYTES) throw new Error("INVALID_IMAGE");
  return {
    key: `event-covers/${randomUUID()}.${png ? "png" : "jpg"}`,
    bytes: clean,
    type: png ? ("image/png" as const) : ("image/jpeg" as const),
  };
}

export async function uploadCover(
  cover: Awaited<ReturnType<typeof prepareCover>>
) {
  const response = await coverRequest("PUT", cover.key, cover.bytes);
  await response.body?.cancel();
  if (!response.ok) throw new Error("IMAGE_UPLOAD_FAILED");
}
export async function removeCover(key: string) {
  if (!KEY.test(key)) return;
  try {
    const response = await coverRequest("DELETE", key);
    await response.body?.cancel();
    if (!response.ok && response.status !== 404)
      console.error("event_cover_cleanup_failed", { status: response.status });
  } catch {
    /* Best-effort orphan cleanup; never corrupt a saved event. */
    console.error("event_cover_cleanup_failed", { status: null });
  }
}
export async function readCover(key: string) {
  if (!KEY.test(key)) return null;
  const response = await coverRequest("GET", key);
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > MAX_COVER_BYTES
  ) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COVER_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return {
      bytes: Buffer.concat(chunks),
      type: key.endsWith(".png") ? "image/png" : "image/jpeg",
    };
  } finally {
    reader.releaseLock();
  }
}

/** Reuse the existing SigV4 signer while preserving membership's stricter key namespace. */
async function coverRequest(
  method: "GET" | "PUT" | "DELETE",
  key: string,
  bytes?: Uint8Array
) {
  if (!KEY.test(key)) throw new Error("Invalid event cover key");
  const config = eventStorage();
  const path = [
    config.endpoint.pathname.replace(/\/+$/, ""),
    config.bucket,
    ...key.split("/"),
  ].join("/");
  const url = new URL(path, config.endpoint.origin);
  const headers = signRequest({
    method,
    url,
    payloadSha256: bytes
      ? createHash("sha256").update(bytes).digest("hex")
      : EMPTY_PAYLOAD_SHA256,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    ...(bytes
      ? {
          headers: {
            "content-type": key.endsWith(".png") ? "image/png" : "image/jpeg",
          },
        }
      : {}),
  });
  delete headers.host;
  return fetch(url, {
    method,
    headers,
    ...(bytes ? { body: new Uint8Array(bytes) } : {}),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
}
