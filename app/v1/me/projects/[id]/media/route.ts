import { memberMedia, projectPreflight } from "@/lib/projects/api";
export const dynamic = "force-dynamic";
export const OPTIONS = projectPreflight;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return memberMedia(request, (await params).id);
}
