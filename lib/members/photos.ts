import "server-only";

import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  documentStorageMode,
  signRequest,
  EMPTY_PAYLOAD_SHA256,
} from "@/lib/membership/storage";
import { boundedBytes } from "@/lib/projects/storage";

/**
 * Member profile photos (ADR 0023): a private bucket of their own, never the ID-card,
 * event-cover or project-image bucket. Uploads are decoded and re-encoded to a 512 px square
 * JPEG, so no metadata (location, camera) survives and the stored object is always small.
 */
export const MAX_PHOTO_UPLOAD_BYTES = 3 * 1024 * 1024;
const KEY = /^member-photos\/[0-9a-f-]{36}\.jpg$/;

function config() {
  const mode = documentStorageMode({
    ...process.env,
    SUPABASE_S3_MEMBERSHIP_BUCKET: process.env.SUPABASE_S3_MEMBER_PHOTO_BUCKET,
  });
  const others = [
    process.env.SUPABASE_S3_MEMBERSHIP_BUCKET,
    process.env.SUPABASE_S3_EVENT_BUCKET,
    process.env.SUPABASE_S3_PROJECT_BUCKET,
  ].map((b) => b?.trim());
  if (mode.mode !== "storage" || others.includes(mode.config.bucket))
    throw new Error("Member photo storage is not configured");
  return mode.config;
}

async function request(
  method: "GET" | "PUT" | "DELETE",
  key: string,
  bytes?: Uint8Array
) {
  if (!KEY.test(key)) throw new Error("Invalid member photo key");
  const c = config();
  const url = new URL(
    [c.endpoint.pathname.replace(/\/+$/, ""), c.bucket, ...key.split("/")].join(
      "/"
    ),
    c.endpoint.origin
  );
  const headers = signRequest({
    method,
    url,
    payloadSha256: bytes
      ? createHash("sha256").update(bytes).digest("hex")
      : EMPTY_PAYLOAD_SHA256,
    region: c.region,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    ...(bytes ? { headers: { "content-type": "image/jpeg" } } : {}),
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

/** Checks the real file type, then re-encodes; anything else is INVALID_IMAGE. */
export async function preparePhoto(bytes: Buffer, declaredType: string) {
  const png = declaredType === "image/png";
  if (
    !bytes.length ||
    bytes.length > MAX_PHOTO_UPLOAD_BYTES ||
    (!png && declaredType !== "image/jpeg")
  )
    throw new Error("INVALID_IMAGE");
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
  if (metadata.format !== (png ? "png" : "jpeg") || (metadata.pages ?? 1) > 1)
    throw new Error("INVALID_IMAGE");
  const clean = await image
    .rotate()
    .resize({ width: 512, height: 512, fit: "cover", position: "attention" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return { key: `member-photos/${randomUUID()}.jpg`, bytes: clean };
}

export async function uploadPhoto(photo: { key: string; bytes: Buffer }) {
  const response = await request("PUT", photo.key, photo.bytes);
  await response.body?.cancel();
  if (!response.ok) throw new Error("IMAGE_UPLOAD_FAILED");
}

export async function readPhoto(key: string) {
  const response = await request("GET", key);
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  return boundedBytes(response, MAX_PHOTO_UPLOAD_BYTES);
}

/** Best effort: a leftover object is private and unreferenced, never a broken profile. */
export async function removePhoto(key: string) {
  if (!KEY.test(key)) return;
  try {
    const response = await request("DELETE", key);
    await response.body?.cancel();
    if (!response.ok && response.status !== 404)
      console.error("member_photo_cleanup_failed", { status: response.status });
  } catch {
    console.error("member_photo_cleanup_failed", { status: null });
  }
}
