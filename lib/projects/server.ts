import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ProjectContent } from "./content";
export type ProjectHistory = {
  id: string;
  revision: number;
  action: string;
  feedback: string | null;
  occurredAt: string;
};
export type ProjectRecord = {
  id: string;
  content: ProjectContent;
  revision: number;
  status: string;
  publishedRevision: number | null;
  publishedMediaIds: string[];
  authorName: string;
  isAuthor: boolean;
  updatedAt: string;
  media: { id: string }[];
  history: ProjectHistory[];
  historyTotal: number;
};
export type Result = {
  code: string;
  id?: string;
  revision?: number;
  key?: string | null;
};
export type ProjectList = Result & { projects: ProjectRecord[]; total: number };
async function result<T>(query: ReturnType<typeof sql>) {
  const rows = await db.execute<{ result: T }>(query);
  if (!rows.length) throw new Error("Project operation unavailable");
  return rows[0].result;
}
export const readProjects = (
  actor: string,
  id: string | null = null,
  review = false,
  status = "all",
  search = "",
  offset = 0
) =>
  result<ProjectList>(
    sql`SELECT private.project_read(${actor}::uuid,${id}::uuid,${review},${status},${search},${offset}) AS result`
  );
export const writeProject = (
  actor: string,
  id: string | null,
  revision: number | null,
  operation: string,
  content: ProjectContent | null = null,
  feedback: string | null = null,
  attest = false
) =>
  result<Result>(
    sql`SELECT private.project_write(${actor}::uuid,${id}::uuid,${revision}::integer,${operation},${content ? JSON.stringify(content) : null}::text::jsonb,${feedback},${attest}) AS result`
  );
export const publicProjects = (id: string | null = null, offset = 0) =>
  result<{
    code: string;
    projects: { id: string; content: ProjectContent; revision: number }[];
    total: number;
    hasMore: boolean;
  }>(
    sql`SELECT private.public_projects(${id}::uuid,${offset}::integer) AS result`
  );
export const mediaChange = (
  actor: string,
  id: string,
  operation: string,
  media: string | null,
  key: string | null = null
) =>
  result<Result>(
    sql`SELECT private.project_media_change(${actor}::uuid,${id}::uuid,${operation},${media}::uuid,${key}) AS result`
  );
export const mediaKey = (actor: string | null, id: string, media: string) =>
  result<string | null>(
    sql`SELECT private.project_media_key(${actor}::uuid,${id}::uuid,${media}::uuid) AS result`
  );
