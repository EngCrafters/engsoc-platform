"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import type { SocietyStat } from "@/content/stats";
import { useI18n } from "./i18n-provider";
import { StatIcon } from "./StatIcon";

/**
 * Society figures.
 *
 * The honesty system from the public content model is preserved exactly: a
 * figure with no verified source renders as a labelled placeholder rather than
 * a zero, and a demonstration value is tagged and footnoted wherever it shows.
 * A reader can always tell which numbers are real.
 */
export function StatsStrip({
  stats,
  title,
}: {
  stats: SocietyStat[];
  title: string;
}) {
  const { t, l } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduced = useReducedMotion();
  const notes = stats.map((stat) => stat.note).filter(Boolean);
  const hasDemo = stats.some((stat) => stat.demo);

  return (
    <section className="mx-auto max-w-[var(--m-content-max)] px-5 py-16 sm:px-8 sm:py-20">
      <h2 className="sr-only">{title}</h2>
      <div ref={ref} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.id}
            className="rounded-m-card border border-m-border bg-m-surface p-6"
          >
            {stat.icon ? (
              <StatIcon id={stat.icon} className="size-8 text-m-brand" />
            ) : null}
            <p className="mt-4 text-4xl font-semibold tabular-nums">
              <StatFigure stat={stat} active={inView && !reduced} />
            </p>
            <p className="mt-2 font-medium">{l(stat.label)}</p>
            {stat.reportingPeriod ? (
              <p className="mt-1 text-sm text-m-ink-2">
                {l(stat.reportingPeriod)}
              </p>
            ) : null}
            {stat.demo ? (
              <p className="mt-3 inline-flex rounded-full border border-dashed border-m-gold px-3 py-1 text-xs font-medium text-m-ink-2">
                {t.stats.demoTag}
              </p>
            ) : null}
            {stat.note ? (
              <p className="mt-3 text-sm text-m-ink-2">
                {t.stats.note(notes.indexOf(stat.note) + 1)} {l(stat.note)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {hasDemo ? (
        <p className="mt-6 text-sm text-m-ink-2">{t.stats.demoNote}</p>
      ) : null}
    </section>
  );
}

function StatFigure({ stat, active }: { stat: SocietyStat; active: boolean }) {
  const { t, intl } = useI18n();

  if (stat.stat.kind === "year-range") {
    return <span>{t.stats.yearRange(stat.stat.from, stat.stat.to)}</span>;
  }
  if (stat.stat.value === null) {
    return (
      <span className="text-base font-normal text-m-ink-2">
        {t.stats.placeholder}
      </span>
    );
  }
  return (
    <CountUp
      value={stat.stat.value}
      suffix={stat.stat.suffix}
      active={active}
      format={(value) => new Intl.NumberFormat(intl).format(value)}
    />
  );
}

function CountUp({
  value,
  suffix,
  active,
  format,
}: {
  value: number;
  suffix?: string;
  active: boolean;
  format: (value: number) => string;
}) {
  // `null` means no animation has run yet; the settled value is the source of
  // truth. Nothing is written to state until the first animation frame, so the
  // effect never triggers a cascading render.
  const [animated, setAnimated] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const duration = 900;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // Ease out, so the figure settles rather than stopping abruptly.
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimated(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, value]);

  const shown = active ? (animated ?? 0) : value;

  return (
    <span>
      {format(shown)}
      {suffix ?? ""}
    </span>
  );
}
