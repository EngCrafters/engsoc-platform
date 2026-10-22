import Link from "next/link";
import { getManagerContext } from "@/lib/auth/manager";
import { readProjects } from "@/lib/projects/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; offset?: string }>;
}) {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  const query = await searchParams;
  const offset = Math.max(0, Number(query.offset) || 0);
  let data;
  try {
    data = await readProjects(
      manager.userId,
      null,
      true,
      query.status || "all",
      (query.q || "").slice(0, 100),
      offset
    );
  } catch {
    return (
      <p role="alert">Projects are unavailable. Migration 0029 is required.</p>
    );
  }
  if (data.code !== "SUCCESS")
    return (
      <p role="alert">
        Projects are reviewed by Society Affairs, Board Administration and
        Technical Team only.
      </p>
    );
  const url = (n: number) =>
    `/admin/projects?${new URLSearchParams({ q: query.q || "", status: query.status || "all", offset: String(n) })}`;
  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        title="Projects Management"
        description="Review member submissions, provide feedback and publish approved revisions. Society Affairs is the reviewing committee."
      />
      <form className="flex flex-wrap gap-3">
        <input
          aria-label="Search projects"
          name="q"
          placeholder="Search title…"
          defaultValue={query.q}
          maxLength={100}
          className="h-10 min-w-0 rounded-md border bg-background px-3"
        />
        <select
          aria-label="Project status"
          name="status"
          defaultValue={query.status || "all"}
          className="h-10 rounded-md border bg-background px-3"
        >
          {[
            "all",
            "draft",
            "submitted",
            "under_review",
            "approved",
            "rejected",
            "changes_requested",
            "published",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">{data.total} projects</p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-4">Project</th>
              <th className="p-4">Author</th>
              <th className="p-4">Review status</th>
              <th className="p-4">Publication</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-4">
                  <Link
                    href={`/admin/projects/${p.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {p.content.title.en ||
                      p.content.title.ar ||
                      "Untitled draft"}
                  </Link>
                  <p className="text-muted-foreground" dir="auto">
                    {p.content.title.ar}
                  </p>
                </td>
                <td className="p-4">{p.authorName}</td>
                <td className="p-4">
                  <Badge variant="secondary">
                    {p.status.replaceAll("_", " ")}
                  </Badge>
                </td>
                <td className="p-4">
                  {p.publishedRevision
                    ? `Published r${p.publishedRevision}`
                    : "Private"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.projects.length && (
          <p className="p-8 text-muted-foreground">
            No projects match this view.
          </p>
        )}
      </div>
      <div className="flex gap-4">
        {offset > 0 && (
          <Link href={url(Math.max(0, offset - 30))}>Previous</Link>
        )}
        {offset + 30 < data.total && <Link href={url(offset + 30)}>Next</Link>}
      </div>
    </section>
  );
}
