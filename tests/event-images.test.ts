import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  prepareCover,
  eventStorage,
  uploadCover,
  readCover,
  removeCover,
} from "../lib/event-management/images";
import { normalizePhone } from "../lib/event-management/phone";

describe("event cover validation", () => {
  it("decodes and re-encodes a real image, strips metadata and assigns a random safe filename", async () => {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#123456" },
    })
      .jpeg()
      .withMetadata({ orientation: 1 })
      .toBuffer();
    const prepared = await prepareCover(
      new File([new Uint8Array(bytes)], "../../unsafe.jpg", {
        type: "image/jpeg",
      })
    );
    expect(prepared.key).toMatch(/^event-covers\/[0-9a-f-]{36}\.jpg$/);
    const info = await sharp(prepared.bytes).metadata();
    expect(info.width).toBe(32);
    expect(info.exif).toBeUndefined();
  });
  it("rejects SVG, mismatched MIME, corrupt images, oversized payloads and decompression bombs", async () => {
    for (const file of [
      new File(["<svg onload='alert(1)'/>"], "cover.svg", {
        type: "image/svg+xml",
      }),
      new File(["<html>not an image</html>"], "cover.jpg", {
        type: "image/jpeg",
      }),
      new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        "broken.png",
        { type: "image/png" }
      ),
    ])
      await expect(prepareCover(file)).rejects.toThrow();
    const large = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(
      prepareCover(
        new File([new Uint8Array(large)], "bomb.png", { type: "image/png" })
      )
    ).rejects.toThrow();
  });
  it("refuses missing event bucket configuration and sharing the membership bucket", () => {
    vi.stubEnv("SUPABASE_S3_EVENT_BUCKET", "");
    expect(() => eventStorage()).toThrow();
    vi.unstubAllEnvs();
  });
  it("uses the event namespace with the shared signer, while leaving membership keys restricted", async () => {
    for (const [name, value] of Object.entries({
      SUPABASE_S3_ENDPOINT: "http://127.0.0.1:9999/storage/v1/s3",
      SUPABASE_S3_REGION: "local-test",
      SUPABASE_S3_ACCESS_KEY_ID: "synthetic-access-key",
      SUPABASE_S3_SECRET_ACCESS_KEY: "synthetic-secret",
      SUPABASE_S3_MEMBERSHIP_BUCKET: "private-ids",
      SUPABASE_S3_EVENT_BUCKET: "private-events",
      VERCEL: "",
    }))
      vi.stubEnv(name, value);
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const cover = await prepareCover(
      new File([new Uint8Array(bytes)], "cover.png", { type: "image/png" })
    );
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        expect(url.pathname).toBe(`/storage/v1/s3/private-events/${cover.key}`);
        expect((init.headers as Record<string, string>).authorization).toMatch(
          /^AWS4-HMAC-SHA256 Credential=synthetic-access-key\//
        );
        requests.push(init);
        return init.method === "GET"
          ? new Response(new Uint8Array(cover.bytes), {
              headers: { "content-type": "image/png" },
            })
          : new Response(null, { status: 200 });
      })
    );
    try {
      await uploadCover(cover);
      expect((await readCover(cover.key))?.bytes).toEqual(cover.bytes);
      await removeCover(cover.key);
      expect(requests.map((r) => r.method)).toEqual(["PUT", "GET", "DELETE"]);
      expect(await readCover("membership-id-cards/forbidden.png")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});
describe("private profile phone", () => {
  it("accepts international formatting without accepting controls or unqualified local numbers", () => {
    expect(normalizePhone("+968 (9123) 4567")).toBe("+96891234567");
    for (const phone of [
      "91234567",
      "+000000000",
      "+968\n91234567",
      "+96891234567x1",
    ])
      expect(normalizePhone(phone)).toBeNull();
  });
});
