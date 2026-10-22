import { getManagerContext } from "@/lib/auth/manager";
import { mediaKey } from "@/lib/projects/server";
import { readProjectImage } from "@/lib/projects/storage";
import { UUID } from "@/lib/projects/content";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; media: string }> }
) {
  const p = await params;
  const manager = await getManagerContext();
  if (manager.kind !== "manager" || !UUID.test(p.id) || !UUID.test(p.media))
    return new Response(null, { status: 404 });
  try {
    const key = await mediaKey(manager.userId, p.id, p.media);
    if (!key) return new Response(null, { status: 404 });
    const image = await readProjectImage(key);
    return image
      ? new Response(new Uint8Array(image.bytes), {
          headers: {
            "content-type": image.type,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        })
      : new Response(null, { status: 404 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
