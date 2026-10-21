import { publicRead } from "@/lib/projects/api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => publicRead(request);
