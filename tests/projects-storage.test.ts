import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundedBytes,
  uploadProjectImage,
  readProjectImage,
  removeProjectImage,
} from "@/lib/projects/storage";

const MEDIA = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  for (const [name, value] of Object.entries({
    SUPABASE_S3_ENDPOINT: "http://127.0.0.1:9999/storage/v1/s3",
    SUPABASE_S3_REGION: "local-test",
    SUPABASE_S3_ACCESS_KEY_ID: "synthetic-access-key",
    SUPABASE_S3_SECRET_ACCESS_KEY: "synthetic-secret",
    SUPABASE_S3_MEMBERSHIP_BUCKET: "private-ids ",
    SUPABASE_S3_EVENT_BUCKET: "private-events ",
    SUPABASE_S3_PROJECT_BUCKET: "private-projects",
    VERCEL: "",
  }))
    vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("project image private storage", () => {
  it("fails before network access for shared/missing buckets and foreign/path traversal keys", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const key = `project-images/${MEDIA}.png`;
    for (const bucket of ["", "private-ids", "private-events"]) {
      vi.stubEnv("SUPABASE_S3_PROJECT_BUCKET", bucket);
      await expect(readProjectImage(key)).rejects.toThrow(
        "Project storage not configured"
      );
    }
    vi.stubEnv("SUPABASE_S3_PROJECT_BUCKET", "private-projects");
    for (const key of [
      `event-covers/${MEDIA}.png`,
      `membership-id-cards/${MEDIA}.png`,
      `project-images/../${MEDIA}.png`,
      `project-images/${MEDIA}.svg`,
      `project-images/${MEDIA}.png?signature=forged`,
    ])
      await expect(readProjectImage(key)).rejects.toThrow(
        "Invalid project key"
      );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("re-encodes real uploads with random project keys, strips EXIF and signs only the separate bucket", async () => {
    const original = await sharp({
      create: { width: 16, height: 12, channels: 3, background: "white" },
    })
      .jpeg()
      .withMetadata({ orientation: 1 })
      .toBuffer();
    const calls: { url: URL; init: RequestInit }[] = [];
    let stored: Uint8Array = new Uint8Array();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        expect(url.origin).toBe("http://127.0.0.1:9999");
        expect(url.pathname).toMatch(
          /^\/storage\/v1\/s3\/private-projects\/project-images\/[0-9a-f-]{36}\.jpg$/
        );
        expect((init.headers as Record<string, string>).authorization).toMatch(
          /^AWS4-HMAC-SHA256 Credential=synthetic-access-key\//
        );
        expect(init.redirect).toBe("error");
        calls.push({ url, init });
        if (init.method === "PUT") stored = init.body as Uint8Array;
        return init.method === "GET"
          ? new Response(new Uint8Array(stored))
          : new Response(null);
      })
    );
    const key = await uploadProjectImage(
      new File([new Uint8Array(original)], "../../untrusted.jpg", {
        type: "image/jpeg",
      })
    );
    expect(key).toMatch(/^project-images\/[0-9a-f-]{36}\.jpg$/);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    const read = await readProjectImage(key);
    expect(read?.type).toBe("image/jpeg");
    expect(read?.bytes).toEqual(Buffer.from(stored));
    await removeProjectImage(key);
    expect(calls.map((c) => c.init.method)).toEqual(["PUT", "GET", "DELETE"]);
    expect(calls.every((c) => c.url.pathname.endsWith(key))).toBe(true);
  });

  it("rejects corrupt uploads before storage and bounds streamed bytes even without a trustworthy length", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadProjectImage(
        new File(["<svg onload='alert(1)'/>"], "disguised.png", {
          type: "image/png",
        })
      )
    ).rejects.toThrow("INVALID_IMAGE");
    expect(fetch).not.toHaveBeenCalled();
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        canceled = true;
      },
    });
    expect(
      await boundedBytes(
        new Response(stream, { headers: { "content-length": "1" } }),
        12
      )
    ).toBeNull();
    expect(canceled).toBe(true);
    expect(
      await boundedBytes(
        new Response(new Uint8Array(4), {
          headers: { "content-length": "100" },
        }),
        12
      )
    ).toBeNull();
  });
});
