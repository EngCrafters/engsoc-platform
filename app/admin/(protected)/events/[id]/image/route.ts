import { getManagerContext } from "@/lib/auth/manager";
import { getAdminEvent } from "@/lib/admin-events/server";
import { readCover } from "@/lib/event-management/images";
import { isUuid } from "@/lib/admin-events/types";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const manager = await getManagerContext();
  if (manager.kind !== "manager" || !isUuid(id))
    return new Response(null, { status: 404 });
  try {
    const event = await getAdminEvent(manager.userId, id);
    const cover = event?.coverImageKey
      ? await readCover(event.coverImageKey)
      : null;
    if (!cover) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(cover.bytes), {
      headers: {
        "content-type": cover.type,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
