import { publicRead } from "@/lib/projects/api";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return publicRead(request, (await params).id);
}
