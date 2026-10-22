import { getPublicEvent } from "@/lib/events";
import { publicEventOptions } from "@/lib/event-management/server";
import { readCover } from "@/lib/event-management/images";
import { isUuid } from "@/lib/admin-events/types";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return new Response(null, { status: 404 });
  try {
    if (!(await getPublicEvent(eventId)))
      return new Response(null, { status: 404 });
    const key = (await publicEventOptions([eventId])).get(
      eventId.toLowerCase()
    )?.coverImageKey;
    const cover = key ? await readCover(key) : null;
    if (!cover) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(cover.bytes), {
      headers: {
        "content-type": cover.type,
        "cache-control": "public, max-age=60, must-revalidate",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
