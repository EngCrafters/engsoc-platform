import Image from "next/image";
import { notFound } from "next/navigation";
import { getManagerContext } from "@/lib/auth/manager";
import { readProjects } from "@/lib/projects/server";
import { UUID, type Localized } from "@/lib/projects/content";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { ProjectReviewForm } from "@/components/admin/project-review-form";
function bilingual(value: Localized) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words">{value.en}</p>
      {value.ar && (
        <p
          dir="rtl"
          lang="ar"
          className="mt-2 whitespace-pre-wrap break-words text-muted-foreground"
        >
          {value.ar}
        </p>
      )}
    </>
  );
}
export default async function ProjectDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  let data;
  try {
    data = await readProjects(manager.userId, id, true);
  } catch {
    return <p role="alert">Project review is temporarily unavailable.</p>;
  }
  if (data.code !== "SUCCESS" || !data.projects[0]) notFound();
  const p = data.projects[0],
    c = p.content;
  const { result } = await searchParams;
  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        title={c.title.en || c.title.ar || "Untitled draft"}
        description={`${p.authorName} · Revision ${p.revision}`}
      />
      <div className="flex gap-3">
        <Badge>{p.status.replaceAll("_", " ")}</Badge>
        <Badge variant="outline">
          {p.publishedRevision
            ? `Published revision ${p.publishedRevision}`
            : "Private"}
        </Badge>
      </div>
      {result && (
        <p role="status" className="rounded-lg border p-4">
          {result === "SUCCESS"
            ? "Project updated."
            : result === "SELF_REVIEW"
              ? "You cannot approve or publish your own project or a project you contributed to."
              : result === "STALE_REVISION"
                ? "This revision changed. Review the current version before trying again."
                : "The operation could not complete. Check the status, feedback and contributor declaration."}
        </p>
      )}
      <div className="rounded-xl border p-6">
        <h2 className="mb-3 font-semibold">Project overview</h2>
        {bilingual(c.title)}
        {bilingual(c.summary)}
        <p className="mt-4 text-sm text-muted-foreground">
          {c.discipline} · {c.type} · {c.year} · {c.stage} ·{" "}
          {c.technologies.join(", ")}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {(
          [
            ["Problem", c.problem],
            ["Solution", c.solution],
            ["Technical approach", c.technicalApproach.overview],
            ["Next steps", c.nextSteps],
            ["Collaboration", c.collaboration.seeking],
            ["Application", c.collaboration.application],
          ] as [string, Localized][]
        ).map(([label, value]) => (
          <article key={label} className="rounded-xl border p-6">
            <h2 className="mb-3 font-semibold">{label}</h2>
            {bilingual(value)}
          </article>
        ))}
      </div>
      <section className="rounded-xl border p-6">
        <h2 className="mb-3 font-semibold">Team and links</h2>
        <ul className="space-y-3">
          {c.team.map((t, i) => (
            <li key={i}>
              {bilingual(t.name)}
              {bilingual(t.role)}
            </li>
          ))}
          {c.links.map((l, i) => (
            <li key={i}>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="break-all underline"
              >
                {l.label.en || l.href}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        {(
          [
            ["Design decisions", c.technicalApproach.decisions],
            ["Development milestones", c.development],
          ] as [string, Localized[]][]
        ).map(([title, items]) => (
          <article key={title} className="rounded-xl border p-6">
            <h2 className="mb-3 font-semibold">{title}</h2>
            {items.length ? (
              <ol className="list-inside list-decimal space-y-3">
                {items.map((item, i) => (
                  <li key={i}>{bilingual(item)}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">None supplied.</p>
            )}
          </article>
        ))}
        <article className="rounded-xl border p-6">
          <h2 className="mb-3 font-semibold">Measured results</h2>
          {c.validation.length ? (
            <dl className="space-y-4">
              {c.validation.map((v, i) => (
                <div key={i}>
                  <dt className="font-medium">{bilingual(v.measure)}</dt>
                  <dd className="mt-1">{bilingual(v.result)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No measured results supplied.
            </p>
          )}
        </article>
        <article className="rounded-xl border p-6">
          <h2 className="mb-3 font-semibold">Parts and materials</h2>
          {c.parts.length ? (
            <ul className="space-y-3">
              {c.parts.map((part, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <div>{bilingual(part.name)}</div>
                  <span className="tabular-nums">×{part.qty}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No parts supplied.</p>
          )}
        </article>
        <article className="rounded-xl border p-6 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Achievements to verify</h2>
          {c.achievements.length ? (
            <ul className="space-y-4">
              {c.achievements.map((a, i) => (
                <li key={i}>
                  {bilingual(a.competition)}
                  <p className="text-sm text-muted-foreground">
                    {a.result} · {a.year}
                  </p>
                  {a.href && (
                    <a
                      href={a.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-1 inline-block break-all text-sm underline"
                    >
                      Results source
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No achievements claimed.
            </p>
          )}
        </article>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {c.mediaIds.map((media) => (
          <div
            key={media}
            className="relative aspect-video overflow-hidden rounded-xl border"
          >
            <Image
              unoptimized
              fill
              className="object-contain"
              src={`/admin/projects/${id}/media/${media}`}
              alt="Project submission image"
            />
          </div>
        ))}
      </section>
      <section className="rounded-xl border p-6">
        <h2 className="mb-3 font-semibold">Decision</h2>
        <ProjectReviewForm
          key={`${id}:${p.revision}:${p.status}`}
          id={id}
          revision={p.revision}
          status={p.status}
          publishedRevision={p.publishedRevision}
          isAuthor={p.isAuthor}
        />
      </section>
      <section className="rounded-xl border p-6">
        <h2 className="mb-4 font-semibold">
          Review history · Member notifications
        </h2>
        {p.historyTotal > p.history.length && (
          <p className="mb-4 text-sm text-muted-foreground">
            Showing the most recent {p.history.length} of {p.historyTotal}{" "}
            updates.
          </p>
        )}
        <ol className="space-y-4">
          {p.history.map((h) => (
            <li key={h.id} className="border-s-2 ps-4">
              <p className="font-medium">
                {h.action.replaceAll("_", " ")} · r{h.revision}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(h.occurredAt).toISOString()}
              </p>
              {h.feedback && (
                <p className="mt-2 whitespace-pre-wrap" dir="auto">
                  {h.feedback}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
