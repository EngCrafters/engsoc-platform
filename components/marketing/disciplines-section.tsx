import Link from "next/link";
import {
  Building2,
  Cog,
  Cpu,
  Factory,
  FlaskConical,
  Fuel,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { DISCIPLINES, type DisciplineId } from "@/content/disciplines";
import { PROJECTS } from "@/content/projects";
import { getI18n } from "@/lib/i18n/server";

/**
 * The society's own seven-discipline list — not an official university
 * department list, and labelled as such by the content module it comes from.
 *
 * The tile keeps the "leaf" corner that recurs throughout the society's mark;
 * it is the one shape the whole identity is built on.
 */
const ICONS: Record<DisciplineId, LucideIcon> = {
  mechanical: Cog,
  electrical: Zap,
  civil: Building2,
  petroleum: Fuel,
  chemical: FlaskConical,
  mechatronics: Cpu,
  industrial: Factory,
};

export async function DisciplinesSection() {
  const { t, l } = await getI18n();

  return (
    <section
      id="disciplines"
      aria-labelledby="disciplines-title"
      className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24"
    >
      <h2
        id="disciplines-title"
        className="max-w-[22ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
      >
        {t.disciplines.title}
      </h2>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DISCIPLINES.map((discipline) => {
          const Icon = ICONS[discipline.id];
          const count = PROJECTS.filter(
            (project) => project.discipline === discipline.id
          ).length;
          return (
            <li key={discipline.id}>
              <Link
                href="/#projects"
                className="flex h-full gap-4 rounded-m-card border border-m-border bg-m-surface p-5 transition-colors hover:border-m-brand"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-[50%_50%_50%_0] bg-m-brand-soft text-m-brand">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {l(discipline.name)}
                  </span>
                  <span className="mt-1 block text-sm text-m-ink-2">
                    {l(discipline.focus)}
                  </span>
                  {count > 0 ? (
                    <span className="mt-2 block text-xs text-m-ink-2">
                      {t.disciplines.sampleProjectsIn(l(discipline.name))}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
