"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { PROJECTS } from "@/content/projects";
import {
  DISCIPLINES,
  DISCIPLINE_BY_ID,
  type DisciplineId,
} from "@/content/disciplines";
import { DRAWINGS } from "./drawings";
import { useI18n } from "./i18n-provider";

type Filter = "all" | DisciplineId;

/**
 * The project archive preview.
 *
 * The discipline filter is local component state on purpose: there is exactly
 * one consumer, so there is no cross-component event bus to keep in sync. Real
 * archive entries will be database rows; until then every card carries its
 * "Sample" tag so a reader is never misled.
 */
export function ProjectsBrowser() {
  const { t, l } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () =>
      filter === "all"
        ? PROJECTS
        : PROJECTS.filter((project) => project.discipline === filter),
    [filter]
  );

  const announcement =
    filter === "all"
      ? t.projects.showingAll(visible.length)
      : t.projects.showingIn(visible.length, l(DISCIPLINE_BY_ID[filter].name));

  return (
    <div>
      <div
        role="group"
        aria-label={t.projects.filterLabel}
        className="flex flex-wrap gap-2"
      >
        <FilterButton
          active={filter === "all"}
          onClick={() => setFilter("all")}
        >
          {t.projects.all}
        </FilterButton>
        {DISCIPLINES.map((discipline) => (
          <FilterButton
            key={discipline.id}
            active={filter === discipline.id}
            onClick={() => setFilter(discipline.id)}
          >
            {l(discipline.shortName)}
          </FilterButton>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((project) => (
          <li key={project.id}>
            <article className="flex h-full flex-col overflow-hidden rounded-m-card border border-m-border bg-m-surface">
              <div className="relative aspect-[16/10] bg-m-surface-soft">
                {project.image ? (
                  <Image
                    src={project.image.src}
                    alt={l(project.image.alt)}
                    fill
                    sizes="(min-width: 64rem) 30vw, (min-width: 40rem) 45vw, 100vw"
                    className="object-cover"
                    style={
                      project.image.focus
                        ? { objectPosition: project.image.focus }
                        : undefined
                    }
                  />
                ) : (
                  <div className="drawing grid size-full place-items-center p-4">
                    <svg
                      viewBox="0 0 480 300"
                      className="size-full"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {DRAWINGS[project.drawing]}
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-5">
                <p className="flex flex-wrap items-center gap-2 text-xs text-m-ink-2">
                  <span className="rounded-full border border-dashed border-m-border-strong px-2 py-0.5">
                    {t.common.sample}
                  </span>
                  <span>
                    {l(DISCIPLINE_BY_ID[project.discipline].shortName)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{project.year}</span>
                </p>
                <h3 className="mt-3 font-semibold">{l(project.title)}</h3>
                <p className="mt-2 text-sm text-m-ink-2">
                  {l(project.summary)}
                </p>
                <p className="mt-4 text-xs text-m-ink-2">
                  {t.projects.teamOf(project.teamSize)}
                </p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="min-h-11 rounded-full border border-m-border px-4 text-sm font-medium transition-colors hover:border-m-brand hover:text-m-brand aria-pressed:border-m-brand aria-pressed:bg-m-brand-soft aria-pressed:text-m-brand"
    >
      {children}
    </button>
  );
}
