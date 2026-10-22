import "server-only";
import { memberRequest } from "@/lib/event-management/api";
import { json, problem, readJsonBody, requestIdFrom } from "@/lib/api/http";
import { corsHeaders, preflight } from "@/lib/api/cors";
import { bearerToken, verifyMemberAccessToken } from "@/lib/auth/member";
import { isProjectContent, UUID } from "./content";
import {
  publicProjects,
  readProjects,
  writeProject,
  mediaChange,
  mediaKey,
  type Result,
} from "./server";
import {
  boundedBytes,
  uploadProjectImage,
  removeProjectImage,
  readProjectImage,
} from "./storage";
import { MAX_COVER_BYTES } from "@/lib/event-management/images";
const CORS = {
  methods: "GET, POST, PATCH, DELETE, OPTIONS",
  headers: "Authorization, Content-Type, X-Request-Id",
};
export function projectPreflight(request: Request) {
  return preflight(request, requestIdFrom(request), CORS);
}
export function projectResult(
  data: Result,
  id: string,
  headers: Record<string, string> = {},
  status = 200
) {
  if (data.code === "SUCCESS")
    return json(
      { data },
      { status, requestId: id, cacheControl: "no-store", headers }
    );
  const kind =
    data.code === "NOT_FOUND"
      ? "not-found"
      : ["FORBIDDEN", "MEMBER_REQUIRED", "SELF_REVIEW"].includes(data.code)
        ? "forbidden"
        : data.code === "VALIDATION_ERROR"
          ? "invalid-fields"
          : [
                "STALE_REVISION",
                "INVALID_TRANSITION",
                "MEDIA_LIMIT",
                "MEDIA_IN_USE",
                "PROJECT_LIMIT",
              ].includes(data.code)
            ? "conflict"
            : "service-unavailable";
  return problem(kind, id, {
    headers,
    errors: [{ field: "project", code: data.code }],
  });
}
export async function publicRead(request: Request, id?: string) {
  const rid = requestIdFrom(request);
  try {
    if (id && !UUID.test(id)) return problem("not-found", rid);
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1000000 ||
      (id && offset !== 0)
    )
      return projectResult({ code: "VALIDATION_ERROR" }, rid);
    const data = await publicProjects(id ?? null, offset);
    if (id && data.code === "SUCCESS" && !data.projects.length)
      return problem("not-found", rid);
    return projectResult(data, rid, {}, 200);
  } catch {
    return problem("service-unavailable", rid);
  }
}
export async function memberProjects(request: Request, id?: string) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const headers = corsHeaders(request.headers.get("origin"), CORS);
  const reply = (d: Result, status = 200) =>
    projectResult(d, auth.requestId!, headers, status);
  if (id && !UUID.test(id)) return reply({ code: "NOT_FOUND" });
  try {
    if (request.method === "GET") {
      const offset = Number(
        new URL(request.url).searchParams.get("offset") ?? 0
      );
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
        return reply({ code: "VALIDATION_ERROR" });
      return reply(
        await readProjects(auth.actor!, id ?? null, false, "all", "", offset)
      );
    }
    const body = await readJsonBody(request, 65536);
    if (!body.ok) return problem(body.reason, auth.requestId!, { headers });
    const v = body.value as Record<string, unknown> | null;
    if (
      !v ||
      Array.isArray(v) ||
      typeof v !== "object" ||
      Object.keys(v).some(
        (k) => !["operation", "content", "revision"].includes(k)
      )
    )
      return reply({ code: "VALIDATION_ERROR" });
    if (!id) {
      if (v.operation !== "create" || !isProjectContent(v.content))
        return reply({ code: "VALIDATION_ERROR" });
      return reply(
        await writeProject(auth.actor!, null, null, "create", v.content),
        201
      );
    }
    if (
      !["save", "submit"].includes(String(v.operation)) ||
      !Number.isInteger(v.revision) ||
      Number(v.revision) < 1 ||
      (v.operation === "save" && !isProjectContent(v.content)) ||
      (v.operation === "submit" && v.content !== undefined)
    )
      return reply({ code: "VALIDATION_ERROR" });
    return reply(
      await writeProject(
        auth.actor!,
        id,
        Number(v.revision),
        String(v.operation),
        v.operation === "save"
          ? (v.content as Parameters<typeof writeProject>[4])
          : null
      )
    );
  } catch {
    return problem("service-unavailable", auth.requestId!, { headers });
  }
}
export async function projectImage(
  request: Request,
  id: string,
  media: string
) {
  const rid = requestIdFrom(request);
  const headers = corsHeaders(request.headers.get("origin"), CORS);
  if (!UUID.test(id) || !UUID.test(media))
    return problem("not-found", rid, { headers });
  try {
    let actor: string | null = null;
    const token = bearerToken(request);
    if (token) {
      const verified = await verifyMemberAccessToken(token);
      if (!verified.ok)
        return problem(
          verified.reason === "unauthorized"
            ? "unauthorized"
            : "service-unavailable",
          rid,
          { headers }
        );
      actor = verified.userId;
    }
    const key = await mediaKey(actor, id, media);
    if (!key) return problem("not-found", rid, { headers });
    const image = await readProjectImage(key);
    if (!image) return problem("not-found", rid, { headers });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        ...headers,
        "content-type": image.type,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
        "referrer-policy": "no-referrer",
      },
    });
  } catch {
    return problem("service-unavailable", rid, { headers });
  }
}
export async function memberMedia(
  request: Request,
  id: string,
  media?: string
) {
  const auth = await memberRequest(request);
  if (auth.response) return auth.response;
  const headers = corsHeaders(request.headers.get("origin"), CORS);
  const reply = (d: Result, status = 200) =>
    projectResult(d, auth.requestId!, headers, status);
  if (!UUID.test(id) || (media && !UUID.test(media)))
    return reply({ code: "NOT_FOUND" });
  try {
    if (request.method === "DELETE" && media) {
      const result = await mediaChange(auth.actor!, id, "remove", media);
      if (result.code === "SUCCESS" && result.key)
        await removeProjectImage(result.key);
      return reply({ code: result.code });
    }
    const own = await readProjects(auth.actor!, id);
    if (own.code !== "SUCCESS") return reply(own);
    const record = own.projects[0];
    if (
      !record ||
      ["submitted", "under_review"].includes(record.status) ||
      (record.status === "approved" &&
        record.publishedRevision !== record.revision)
    )
      return reply({ code: "INVALID_TRANSITION" });
    const type = request.headers.get("content-type") ?? "";
    if (!["image/jpeg", "image/png"].includes(type))
      return reply({ code: "VALIDATION_ERROR" });
    const bytes = await boundedBytes(request, MAX_COVER_BYTES);
    if (!bytes || !bytes.length)
      return problem("payload-too-large", auth.requestId!, { headers });
    let key: string;
    try {
      key = await uploadProjectImage(
        new File([new Uint8Array(bytes)], "upload", { type })
      );
    } catch (error) {
      return reply({
        code:
          error instanceof Error && error.message === "INVALID_IMAGE"
            ? "VALIDATION_ERROR"
            : "UNAVAILABLE",
      });
    }
    // Retain the object on an uncertain database commit; never delete a possibly saved image.
    const saved = await mediaChange(auth.actor!, id, "add", null, key);
    if (saved.code !== "SUCCESS") await removeProjectImage(key);
    return reply({ code: saved.code, id: saved.id }, 201);
  } catch {
    return problem("service-unavailable", auth.requestId!, { headers });
  }
}
