import { memberProjects, projectPreflight } from "@/lib/projects/api";
export const dynamic = "force-dynamic";
export const OPTIONS = projectPreflight;
export const GET = (request: Request) => memberProjects(request);
export const POST = GET;
