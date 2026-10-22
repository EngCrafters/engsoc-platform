import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import type { DocumentMediaType } from "./types";

/**
 * Private Supabase Storage for SQU ID cards (ADR 0018), through Storage's
 * S3-compatible API. The S3 access keys live only here: they are read from
 * server-only environment variables, used only to sign requests (AWS
 * Signature Version 4), and never logged, returned or sent to a browser.
 * Objects are addressed path-style and never given a public or signed URL;
 * reviewers receive the bytes through Core's authenticated document route.
 */

export const STORAGE_ENV = [
  "SUPABASE_S3_ENDPOINT",
  "SUPABASE_S3_REGION",
  "SUPABASE_S3_ACCESS_KEY_ID",
  "SUPABASE_S3_SECRET_ACCESS_KEY",
  "SUPABASE_S3_MEMBERSHIP_BUCKET",
] as const;

export type StorageConfig = {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * `database`: no Storage variable is set, so documents stay in PostgreSQL
 * (migration 0025). `storage`: all are set and valid. `misconfigured`: some
 * are missing or invalid; submissions are refused rather than silently stored
 * somewhere else. `problems` holds variable names only, never values.
 */
export type DocumentStorageMode =
  | { mode: "database" }
  | { mode: "storage"; config: StorageConfig }
  | { mode: "misconfigured"; problems: string[] };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

function parseEndpoint(raw: string, deployed: boolean): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Plain http only for a local S3 stand-in on this machine, never when deployed.
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && !deployed && LOOPBACK.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) {
    return null;
  }
  return url;
}

export function documentStorageMode(
  env: Record<string, string | undefined> = process.env
): DocumentStorageMode {
  const value = (name: (typeof STORAGE_ENV)[number]) => env[name]?.trim() ?? "";
  if (STORAGE_ENV.every((name) => value(name) === "")) {
    return { mode: "database" };
  }
  const problems: string[] = [];
  const endpoint = parseEndpoint(
    value("SUPABASE_S3_ENDPOINT"),
    Boolean(env.VERCEL)
  );
  if (!endpoint) problems.push("SUPABASE_S3_ENDPOINT");
  const region = value("SUPABASE_S3_REGION");
  if (!/^[a-z0-9-]{2,32}$/.test(region)) problems.push("SUPABASE_S3_REGION");
  const accessKeyId = value("SUPABASE_S3_ACCESS_KEY_ID");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(accessKeyId)) {
    problems.push("SUPABASE_S3_ACCESS_KEY_ID");
  }
  const secretAccessKey = value("SUPABASE_S3_SECRET_ACCESS_KEY");
  if (secretAccessKey.length < 8 || /\s/.test(secretAccessKey)) {
    problems.push("SUPABASE_S3_SECRET_ACCESS_KEY");
  }
  const bucket = value("SUPABASE_S3_MEMBERSHIP_BUCKET");
  if (!BUCKET_PATTERN.test(bucket))
    problems.push("SUPABASE_S3_MEMBERSHIP_BUCKET");
  if (problems.length > 0 || !endpoint)
    return { mode: "misconfigured", problems };
  return {
    mode: "storage",
    config: { endpoint, region, bucket, accessKeyId, secretAccessKey },
  };
}

let reportedMisconfiguration = false;

/** The mode for this process; a misconfiguration is logged once, by name only. */
export function currentDocumentStorage(): DocumentStorageMode {
  const mode = documentStorageMode();
  if (mode.mode === "misconfigured" && !reportedMisconfiguration) {
    reportedMisconfiguration = true;
    console.error("membership_storage_misconfigured", {
      variables: mode.problems,
    });
  }
  return mode;
}

const EXTENSIONS: Record<DocumentMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const DOCUMENT_KEY_PATTERN =
  /^membership-id-cards\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

/** A random object key: no name, email, student ID or original file name. */
export function newDocumentKey(mediaType: DocumentMediaType): string {
  return `membership-id-cards/${randomUUID()}.${EXTENSIONS[mediaType]}`;
}

// ---------------------------------------------------------------------------
// AWS Signature Version 4 (single request, header-based, signed payload).
// ---------------------------------------------------------------------------

const sha256Hex = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data, "utf8").digest();

export const EMPTY_PAYLOAD_SHA256 = sha256Hex("");

/** RFC 3986 encoding as SigV4 requires: everything but A–Z a–z 0–9 - . _ ~ */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

const canonicalPath = (pathname: string) =>
  pathname
    .split("/")
    .map((segment) => encodeSegment(decodeURIComponent(segment)))
    .join("/");

const amzDate = (now: Date) =>
  now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/**
 * The headers to send with a request, including its SigV4 Authorization.
 * `headers` are signed as given (lower-cased); `host`, `x-amz-date` and
 * `x-amz-content-sha256` are added. The secret never leaves this function.
 */
export function signRequest(input: {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadSha256: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
  service?: string;
}): Record<string, string> {
  const service = input.service ?? "s3";
  const timestamp = amzDate(input.now ?? new Date());
  const day = timestamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers.host = input.url.host;
  headers["x-amz-date"] = timestamp;
  headers["x-amz-content-sha256"] = input.payloadSha256;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname),
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    input.payloadSha256,
  ].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region),
      service
    ),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  // fetch sets Host from the URL itself; it is signed above but not sent here.
  const sent = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name !== "host")
  );
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ---------------------------------------------------------------------------
// Single-object operations.
// ---------------------------------------------------------------------------

type Fetch = typeof fetch;

/**
 * What the deletion queue may hold (0032): ID cards, event covers, project images and member
 * photos, matching the queue's own CHECK. Reads and uploads still accept ID cards only.
 */
export const QUEUED_KEY_PATTERN =
  /^(membership-id-cards\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)|event-covers\/[0-9a-f-]{36}\.(jpg|png)|project-images\/[0-9a-f-]{36}\.(jpg|png)|member-photos\/[0-9a-f-]{36}\.jpg)$/;

function objectUrl(
  config: StorageConfig,
  key: string,
  pattern: RegExp = DOCUMENT_KEY_PATTERN
): URL {
  if (!pattern.test(key)) throw new Error("Invalid document key.");
  const base = config.endpoint.pathname.replace(/\/+$/, "");
  const path = [base, config.bucket, ...key.split("/")]
    .map((part, index) => (index === 0 ? part : encodeSegment(part)))
    .join("/");
  return new URL(path, config.endpoint.origin);
}

function signed(
  config: StorageConfig,
  method: string,
  url: URL,
  payloadSha256: string,
  headers?: Record<string, string>
) {
  return signRequest({
    method,
    url,
    headers,
    payloadSha256,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
}

function logFailure(operation: string, status: number | null) {
  // Operation and HTTP status only: no key, URL, header or response body.
  console.error("membership_storage_failed", { operation, status });
}

/**
 * Stores the document. `uncertain` means the request may have reached
 * Storage (a timeout or dropped connection), so the caller must treat the
 * object as possibly present and queue it for deletion.
 */
export async function putDocumentObject(
  config: StorageConfig,
  key: string,
  bytes: Uint8Array,
  mediaType: DocumentMediaType,
  sha256: string,
  fetchImpl: Fetch = fetch
): Promise<{ ok: true } | { ok: false; uncertain: boolean }> {
  const url = objectUrl(config, key);
  try {
    const response = await fetchImpl(url, {
      method: "PUT",
      headers: signed(config, "PUT", url, sha256, {
        "content-type": mediaType,
      }),
      // A plain ArrayBuffer-backed copy: what fetch's BodyInit type accepts.
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    await response.body?.cancel();
    if (response.ok) return { ok: true };
    logFailure("put", response.status);
    return { ok: false, uncertain: response.status >= 500 };
  } catch {
    logFailure("put", null);
    return { ok: false, uncertain: true };
  }
}

/** Reads the document, refusing anything larger than `maxBytes`. */
export async function getDocumentObject(
  config: StorageConfig,
  key: string,
  maxBytes: number,
  fetchImpl: Fetch = fetch
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; missing: boolean }> {
  const url = objectUrl(config, key);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: signed(config, "GET", url, EMPTY_PAYLOAD_SHA256),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      logFailure("get", response.status);
      return { ok: false, missing: response.status === 404 };
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      logFailure("get", response.status);
      return { ok: false, missing: false };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) return { ok: false, missing: false };
    return { ok: true, bytes };
  } catch {
    logFailure("get", null);
    return { ok: false, missing: false };
  }
}

/** Deletes the object; an object that is already gone counts as deleted. */
export async function deleteDocumentObject(
  config: StorageConfig,
  key: string,
  fetchImpl: Fetch = fetch
): Promise<boolean> {
  try {
    // Queued keys only; an unexpected one fails this item, never the whole queue run.
    const url = objectUrl(config, key, QUEUED_KEY_PATTERN);
    const response = await fetchImpl(url, {
      method: "DELETE",
      headers: signed(config, "DELETE", url, EMPTY_PAYLOAD_SHA256),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    await response.body?.cancel();
    if (response.ok || response.status === 404) return true;
    logFailure("delete", response.status);
    return false;
  } catch {
    logFailure("delete", null);
    return false;
  }
}
