import { PROJECTS } from "@/content/projects";
import { getI18n } from "@/lib/i18n/server";
import { ProjectsBrowser } from "./projects-browser";

/** Projects and publications, kept with their discipline, year and team. */
export async function ProjectsSection() {
  const { t } = await getI18n();
  const sample = PROJECTS.some((project) => project.sample);

  return (
    <section
      id="projects"
      aria-labelledby="projects-title"
      className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24"
    >
      <h2
        id="projects-title"
        className="max-w-[22ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
      >
        {t.projects.title}
      </h2>
      <p className="mt-4 max-w-[var(--m-measure)] text-lg text-m-ink-2">
        {t.projects.lead}
      </p>
      {sample ? (
        <p className="mt-4 max-w-[var(--m-measure)] text-sm text-m-ink-2">
          <strong className="font-semibold text-m-ink">
            {t.projects.sampleStrong}
          </strong>{" "}
          {t.projects.sampleBody}
        </p>
      ) : null}
      <div className="mt-10">
        <ProjectsBrowser />
      </div>
    </section>
  );
}
