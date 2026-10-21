import { memberMedia } from "@/lib/projects/api";
import { preflight } from "@/lib/api/cors";
import { requestIdFrom } from "@/lib/api/http";
export const dynamic = "force-dynamic";
export const OPTIONS = (request: Request) =>
  preflight(request, requestIdFrom(request), {
    methods: "DELETE, OPTIONS",
    headers: "Authorization, Content-Type, X-Request-Id",
  });
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; media: string }> }
) {
  const p = await params;
  return memberMedia(request, p.id, p.media);
}
