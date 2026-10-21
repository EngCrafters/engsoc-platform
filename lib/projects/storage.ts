import "server-only";
import { createHash } from "node:crypto";
import {
  documentStorageMode,
  signRequest,
  EMPTY_PAYLOAD_SHA256,
} from "@/lib/membership/storage";
import { MAX_COVER_BYTES, prepareCover } from "@/lib/event-management/images";
const KEY = /^project-images\/[0-9a-f-]{36}\.(jpg|png)$/;
function config() {
  const mode = documentStorageMode({
    ...process.env,
    SUPABASE_S3_MEMBERSHIP_BUCKET: process.env.SUPABASE_S3_PROJECT_BUCKET,
  });
  if (
    mode.mode !== "storage" ||
    [
      process.env.SUPABASE_S3_MEMBERSHIP_BUCKET?.trim(),
      process.env.SUPABASE_S3_EVENT_BUCKET?.trim(),
    ].includes(mode.config.bucket)
  )
    throw new Error("Project storage not configured");
  return mode.config;
}
async function request(
  method: "GET" | "PUT" | "DELETE",
  key: string,
  bytes?: Uint8Array
) {
  if (!KEY.test(key)) throw new Error("Invalid project key");
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
    signal: AbortSignal.timeout(20000),
  });
}
export async function uploadProjectImage(file: File) {
  let clean;
  try {
    clean = await prepareCover(file);
  } catch {
    throw new Error("INVALID_IMAGE");
  }
  const key = clean.key.replace("event-covers/", "project-images/");
  const response = await request("PUT", key, clean.bytes);
  await response.body?.cancel();
  if (!response.ok) throw new Error("IMAGE_UPLOAD_FAILED");
  return key;
}
export async function removeProjectImage(key: string) {
  try {
    const response = await request("DELETE", key);
    await response.body?.cancel();
    if (!response.ok && response.status !== 404)
      console.error("project_image_cleanup_failed");
  } catch {
    console.error("project_image_cleanup_failed");
  }
}
export async function readProjectImage(key: string) {
  const response = await request("GET", key);
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await boundedBytes(response, MAX_COVER_BYTES);
  return bytes
    ? { bytes, type: key.endsWith(".png") ? "image/png" : "image/jpeg" }
    : null;
}
export async function boundedBytes(source: Request | Response, max: number) {
  if (Number(source.headers.get("content-length")) > max) {
    await source.body?.cancel();
    return null;
  }
  const reader = source.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}
