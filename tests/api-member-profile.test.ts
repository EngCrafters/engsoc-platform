import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  own: vi.fn(),
  update: vi.fn(),
  setPhoto: vi.fn(),
  photoKey: vi.fn(),
  registrations: vi.fn(),
  change: vi.fn(),
  upload: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: state.getUser } }),
}));
vi.mock("@/lib/members/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/members/profile")>()),
  ownProfile: state.own,
  updateOwnProfile: state.update,
  setOwnPhoto: state.setPhoto,
  ownPhotoKey: state.photoKey,
  ownRegistrations: state.registrations,
  requestProfileChange: state.change,
}));
vi.mock("@/lib/members/photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/members/photos")>()),
  uploadPhoto: state.upload,
  readPhoto: state.read,
  removePhoto: state.remove,
}));
const profile = await import("../app/v1/me/profile/route");
const photo = await import("../app/v1/me/profile/photo/route");
const changes = await import("../app/v1/me/profile/changes/route");
const events = await import("../app/v1/me/events/route");

const USER = "11111111-1111-4111-8111-111111111111";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";
function request(
  method: string,
  body?: BodyInit | object | null,
  headers: Record<string, string> = {}
) {
  const raw = body instanceof Buffer || typeof body === "string";
  return new Request("https://api.essqu.com/v1/me/profile", {
    method,
    headers: {
      origin: "https://essqu.com",
      authorization: `Bearer ${JWT}`,
      "content-type": "application/json",
      ...headers,
    },
    ...(body !== undefined
      ? { body: raw ? (body as BodyInit) : JSON.stringify(body) }
      : {}),
  });
}
const edit = {
  phone: "+968 9123 4567",
  academicYear: 3,
  discipline: "civil",
  interests: ["cad", "hse"],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CORE_API_ALLOWED_ORIGINS", "https://essqu.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic");
  state.getUser.mockResolvedValue({
    data: { user: { id: USER } },
    error: null,
  });
  state.own.mockResolvedValue({
    code: "SUCCESS",
    name: "Synthetic",
    email: "s@squ.edu.om",
  });
  state.update.mockResolvedValue({ code: "SUCCESS", name: "Synthetic" });
  state.setPhoto.mockResolvedValue({ code: "SUCCESS", previousKey: null });
  state.registrations.mockResolvedValue({ code: "SUCCESS", registrations: [] });
  state.change.mockResolvedValue({ code: "SUCCESS", changeRequests: [] });
  state.upload.mockResolvedValue(undefined);
});

describe("own profile API (ADR 0023)", () => {
  it("serves only the verified member, with the features Core allows", async () => {
    const response = await profile.GET(request("GET"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      name: "Synthetic",
      features: { photoUploads: true, profileEditing: true },
    });
    expect(state.own).toHaveBeenCalledWith(USER);
    expect(
      (await profile.GET(request("GET", undefined, { authorization: "" })))
        .status
    ).toBe(401);
    state.own.mockResolvedValue({ code: "MEMBER_REQUIRED" });
    expect((await profile.GET(request("GET"))).status).toBe(403);
  });

  it("edits only the self-service fields, validated, and never name, email or student ID", async () => {
    const ok = await profile.PATCH(request("PATCH", edit));
    expect(ok.status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(USER, {
      phone: "+96891234567",
      academicYear: 3,
      discipline: "civil",
      interests: ["cad", "hse"],
    });
    const field = async (body: object) =>
      (await (await profile.PATCH(request("PATCH", body))).json()).errors?.[0]
        ?.field;
    expect(await field({ ...edit, academicYear: 9 })).toBe("academicYear");
    expect(await field({ ...edit, discipline: "astronomy" })).toBe(
      "discipline"
    );
    expect(await field({ ...edit, interests: ["cad", "cad"] })).toBe(
      "interests"
    );
    expect(await field({ ...edit, phone: "9123" })).toBe("phone");
    expect(await field({ ...edit, name: "Someone Else" })).toBe("profile");
    expect(await field({ ...edit, universityId: "123456" })).toBe("profile");
    expect(
      await field({
        academicYear: edit.academicYear,
        discipline: edit.discipline,
        interests: edit.interests,
      })
    ).toBe("profile");
    expect(state.update).toHaveBeenCalledTimes(1);
    // An empty phone clears it.
    await profile.PATCH(request("PATCH", { ...edit, phone: "" }));
    expect(state.update).toHaveBeenLastCalledWith(
      USER,
      expect.objectContaining({ phone: null })
    );
  });

  it("refuses edits and uploads when the developer switches are off, but still removes photos", async () => {
    vi.stubEnv("MEMBER_PROFILE_EDITING", "disabled");
    vi.stubEnv("MEMBER_PHOTO_UPLOADS", "disabled");
    const refused = await profile.PATCH(request("PATCH", edit));
    expect(refused.status).toBe(403);
    expect((await refused.json()).errors[0].code).toBe("EDITING_DISABLED");
    expect(
      (
        await photo.PUT(
          request("PUT", Buffer.from([1]), { "content-type": "image/png" })
        )
      ).status
    ).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
    state.setPhoto.mockResolvedValue({
      code: "SUCCESS",
      previousKey: "member-photos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg",
    });
    expect((await photo.DELETE(request("DELETE"))).status).toBe(200);
    expect(state.remove).toHaveBeenCalledWith(
      "member-photos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg"
    );
    const features = (await (await profile.GET(request("GET"))).json()).data
      .features;
    expect(features).toEqual({ photoUploads: false, profileEditing: false });
  });

  it("accepts only real JPEG/PNG photos, re-encodes them and deletes the replaced one", async () => {
    expect(
      (
        await photo.PUT(
          request("PUT", Buffer.from("GIF89a"), { "content-type": "image/gif" })
        )
      ).status
    ).toBe(415);
    const fake = await photo.PUT(
      request("PUT", Buffer.from("not really a png"), {
        "content-type": "image/png",
      })
    );
    expect(fake.status).toBe(422);
    const png = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#146b50" },
    })
      .withMetadata({
        exif: { IFD0: { Copyright: "synthetic-location-secret" } },
      })
      .png()
      .toBuffer();
    const previous = "member-photos/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg";
    state.setPhoto.mockResolvedValue({
      code: "SUCCESS",
      previousKey: previous,
    });
    const saved = await photo.PUT(
      request("PUT", png, { "content-type": "image/png" })
    );
    expect(saved.status).toBe(201);
    const stored = state.upload.mock.calls[0][0];
    expect(stored.key).toMatch(/^member-photos\/[0-9a-f-]{36}\.jpg$/);
    const meta = await sharp(stored.bytes).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual([
      "jpeg",
      512,
      512,
      undefined,
    ]);
    expect(state.remove).toHaveBeenCalledWith(previous);
    expect((await saved.json()).data.photoVersion).toBe(
      stored.key.slice(14, -4)
    );
    // A failed save removes the new object and keeps the old one.
    state.setPhoto.mockResolvedValue({ code: "MEMBER_REQUIRED" });
    state.remove.mockClear();
    expect(
      (await photo.PUT(request("PUT", png, { "content-type": "image/png" })))
        .status
    ).toBe(403);
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.remove.mock.calls[0][0]).not.toBe(previous);
  });

  it("serves the photo only to its owner, never cached", async () => {
    state.photoKey.mockResolvedValue(null);
    expect((await photo.GET(request("GET"))).status).toBe(404);
    state.photoKey.mockResolvedValue(
      "member-photos/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg"
    );
    state.read.mockResolvedValue(new Uint8Array([255, 216, 255]));
    const response = await photo.GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(
      (await photo.GET(request("GET", undefined, { authorization: "" }))).status
    ).toBe(401);
  });

  it("takes verified-field corrections as requests, and lists own events", async () => {
    expect(
      (
        await changes.POST(
          request("POST", { field: "email", value: "x@squ.edu.om" })
        )
      ).status
    ).toBe(422);
    expect(
      (
        await changes.POST(
          request("POST", {
            field: "full_name",
            value: "New Name",
            memberId: USER,
          })
        )
      ).status
    ).toBe(422);
    const created = await changes.POST(
      request("POST", { field: "full_name", value: "New Name" })
    );
    expect(created.status).toBe(201);
    expect(state.change).toHaveBeenCalledWith(USER, "full_name", "New Name");
    state.change.mockResolvedValue({ code: "ALREADY_PENDING" });
    expect(
      (
        await changes.POST(
          request("POST", { field: "full_name", value: "Other" })
        )
      ).status
    ).toBe(409);
    expect((await events.GET(request("GET"))).status).toBe(200);
    expect(state.registrations).toHaveBeenCalledWith(USER);
    const preflight = photo.OPTIONS(request("OPTIONS"));
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "PUT"
    );
  });
});
