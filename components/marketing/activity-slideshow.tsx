"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { GalleryEvent } from "@/content/activities";
import { useI18n } from "./i18n-provider";
import { IconPause, IconPlay } from "./icons";

const INTERVAL_MS = 5200;

/**
 * A programme's previous events, as a slideshow.
 *
 * Autoplay is off under reduced motion and pauses on hover, focus, touch and
 * when off screen. Arrow keys and the dots are the keyboard path; swipe is the
 * touch path. The counter is announced politely rather than on every frame.
 */
export function ActivitySlideshow({
  events,
  label,
}: {
  events: GalleryEvent[];
  label: string;
}) {
  const { t, l, intl } = useI18n();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const count = events.length;

  const autoplay = playing && !reduced && count > 1 && visible;

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count]
  );

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      {
        rootMargin: "120px 0px",
      }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(
      () => setIndex((current) => (current + 1) % count),
      INTERVAL_MS
    );
    return () => window.clearInterval(id);
  }, [autoplay, count]);

  if (count === 0) return null;

  const event = events[index];

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onMouseEnter={() => setPlaying(false)}
      onFocus={() => setPlaying(false)}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "ArrowRight") {
          keyEvent.preventDefault();
          go(index + 1);
        }
        if (keyEvent.key === "ArrowLeft") {
          keyEvent.preventDefault();
          go(index - 1);
        }
      }}
      onTouchStart={(touchEvent) => {
        touchStart.current = touchEvent.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(touchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (start === null) return;
        const delta = (touchEvent.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(delta) < 40) return;
        go(index + (delta < 0 ? 1 : -1));
      }}
      className="relative overflow-hidden rounded-m-plate bg-m-surface-soft"
    >
      <div className="relative aspect-[4/3]">
        {events.map((item, itemIndex) => (
          <Image
            key={item.id}
            src={item.image.src}
            alt={itemIndex === index ? l(item.image.alt) : ""}
            aria-hidden={itemIndex === index ? undefined : true}
            fill
            sizes="(min-width: 64rem) 46vw, 100vw"
            className={`object-cover transition-opacity duration-700 ${itemIndex === index ? "opacity-100" : "opacity-0"}`}
            style={{ objectPosition: item.image.focus }}
          />
        ))}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(180deg,transparent,rgb(9_24_56/0.78))]"
        />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <p className="flex flex-wrap items-center gap-2 text-sm text-white/80">
            <time dateTime={event.date}>
              {new Intl.DateTimeFormat(intl, {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${event.date}T00:00:00Z`))}
            </time>
            <span>
              ·{" "}
              {t.activities[event.attendance.kind](
                event.attendance.count,
                new Intl.NumberFormat(intl).format(event.attendance.count)
              )}
            </span>
            {event.demo ? (
              <span className="rounded-full border border-dashed border-white/50 px-2 py-0.5 text-xs">
                {t.activities.demo}
              </span>
            ) : null}
          </p>
          <p className="mt-1 font-semibold">{l(event.title)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-m-border bg-m-surface p-3">
        <div className="flex flex-wrap gap-1.5">
          {events.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              aria-label={t.activities.showSlide(itemIndex + 1, l(item.title))}
              aria-current={itemIndex === index ? "true" : undefined}
              onClick={() => go(itemIndex)}
              className="size-2.5 rounded-full bg-m-border-strong aria-current:bg-m-brand"
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-m-ink-2" aria-live="polite">
            {t.activities.slideOf(index + 1, count)}
          </span>
          {count > 1 && !reduced ? (
            <button
              type="button"
              onClick={() => setPlaying((value) => !value)}
              className="grid size-9 place-items-center rounded-full border border-m-border text-m-ink-2 hover:text-m-brand"
            >
              {playing ? (
                <IconPause className="size-4" />
              ) : (
                <IconPlay className="size-4" />
              )}
              <span className="sr-only">
                {playing ? t.activities.pause : t.activities.play}
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
