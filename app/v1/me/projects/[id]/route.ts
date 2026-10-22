import { memberProjects, projectPreflight } from "@/lib/projects/api";
export const dynamic = "force-dynamic";
export const OPTIONS = projectPreflight;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return memberProjects(request, (await params).id);
}
export const PATCH = GET;
