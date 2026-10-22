import { logServerError } from "@/lib/api/log";
import { preflight, type CorsPolicy } from "@/lib/api/cors";
import { memberRequest, memberResult } from "@/lib/event-management/api";
import { json, problem, requestIdFrom } from "@/lib/api/http";
import {
  MAX_PHOTO_UPLOAD_BYTES,
  preparePhoto,
  readPhoto,
  removePhoto,
  uploadPhoto,
} from "@/lib/members/photos";
import {
  memberFeatures,
  ownPhotoKey,
  setOwnPhoto,
} from "@/lib/members/profile";
import { boundedBytes } from "@/lib/projects/storage";
export const dynamic = "force-dynamic";

const PHOTO_CORS: CorsPolicy = {
  methods: "GET, PUT, DELETE, OPTIONS",
  headers: "Authorization, Content-Type, X-Request-Id",
};
export function OPTIONS(request: Request) {
  return preflight(request, requestIdFrom(request), PHOTO_CORS);
}

/** The member's own photo, to the member only (ADR 0023). */
export async function GET(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    const key = await ownPhotoKey(auth.actor!);
    const bytes = key ? await readPhoto(key) : null;
    if (!bytes)
      return problem("not-found", auth.requestId!, { headers: auth.cors });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...auth.cors,
        "content-type": "image/jpeg",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "x-request-id": auth.requestId!,
      },
    });
  } catch (error) {
    logServerError("member_photo_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}

/** Replaces the photo with a re-encoded copy of a JPEG or PNG of at most 3 MiB. */
export async function PUT(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  if (!memberFeatures().photoUploads)
    return problem("forbidden", auth.requestId!, {
      headers: auth.cors,
      errors: [{ field: "photo", code: "UPLOADS_DISABLED" }],
    });
  const type = request.headers.get("content-type") ?? "";
  if (!["image/jpeg", "image/png"].includes(type))
    return problem("unsupported-media-type", auth.requestId!, {
      headers: auth.cors,
    });
  const bytes = await boundedBytes(request, MAX_PHOTO_UPLOAD_BYTES);
  if (!bytes || !bytes.length)
    return problem("payload-too-large", auth.requestId!, {
      headers: auth.cors,
    });
  let photo;
  try {
    photo = await preparePhoto(Buffer.from(bytes), type);
  } catch {
    return memberResult(
      { code: "VALIDATION_ERROR", field: "photo" },
      auth.requestId!,
      auth.cors!
    );
  }
  try {
    await uploadPhoto(photo);
  } catch (error) {
    logServerError("member_photo_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
  try {
    const saved = await setOwnPhoto(auth.actor!, photo.key);
    if (saved.code !== "SUCCESS") {
      await removePhoto(photo.key);
      return memberResult(saved, auth.requestId!, auth.cors!);
    }
    if (typeof saved.previousKey === "string")
      await removePhoto(saved.previousKey);
    return json(
      {
        data: {
          code: "SUCCESS",
          photoVersion: photo.key.slice("member-photos/".length, -4),
        },
      },
      {
        status: 201,
        requestId: auth.requestId!,
        cacheControl: "no-store",
        headers: auth.cors,
      }
    );
  } catch (error) {
    // The row may have committed; keep the object rather than risk a broken photo.
    logServerError("member_photo_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}

/** Removing a photo is always allowed, even with uploads switched off. */
export async function DELETE(request: Request) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  try {
    const saved = await setOwnPhoto(auth.actor!, null);
    if (saved.code === "SUCCESS" && typeof saved.previousKey === "string")
      await removePhoto(saved.previousKey);
    return memberResult(
      saved.code === "SUCCESS" ? { code: "SUCCESS" } : saved,
      auth.requestId!,
      auth.cors!
    );
  } catch (error) {
    logServerError("member_photo_failed", error, auth.requestId);
    return problem("service-unavailable", auth.requestId!, {
      headers: auth.cors,
    });
  }
}
