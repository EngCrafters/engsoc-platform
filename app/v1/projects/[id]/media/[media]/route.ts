import { projectImage, projectPreflight } from "@/lib/projects/api";
export const dynamic = "force-dynamic";
export const OPTIONS = projectPreflight;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; media: string }> }
) {
  const p = await params;
  return projectImage(request, p.id, p.media);
}
