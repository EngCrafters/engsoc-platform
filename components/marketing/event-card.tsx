import Link from "next/link";
import type { MarketingEventCardModel } from "@/lib/marketing/adapters";
import { IconArrowRight, IconCalendar, IconPin } from "./icons";

/**
 * One public event. Presentation only — every field arrives already formatted
 * from lib/marketing/adapters.ts, which is the single translation point from
 * the canonical PublicEvent DTO.
 */
export function EventCard({
  event,
  featured = false,
}: {
  event: MarketingEventCardModel;
  featured?: boolean;
}) {
  return (
    <article
      className={`group flex flex-col rounded-m-card border border-m-border bg-m-surface p-6 transition-colors hover:border-m-brand ${
        featured ? "lg:p-8" : ""
      }`}
    >
      <p className="flex items-center gap-2 text-sm text-m-ink-2">
        <IconCalendar className="size-4 shrink-0" />
        <time dateTime={event.dateIso}>
          {featured ? event.dateLabel : event.dateShort}
        </time>
      </p>
      <h3
        className={`mt-3 font-semibold ${featured ? "text-2xl sm:text-3xl" : "text-xl"}`}
      >
        <Link
          href={event.href}
          className="after:absolute after:inset-0 focus-visible:outline-none"
        >
          {event.title}
        </Link>
      </h3>
      <p className="mt-2 text-sm text-m-ink-2">
        {event.committeeName}
        {event.location ? (
          <>
            {" · "}
            <span className="inline-flex items-center gap-1">
              <IconPin className="size-3.5" />
              {event.location}
            </span>
          </>
        ) : null}
      </p>
      <p className={`mt-3 text-m-ink-2 ${featured ? "" : "line-clamp-3"}`}>
        {event.description}
      </p>
      <p className="mt-5 flex items-center gap-2 text-sm font-medium text-m-brand">
        {event.availabilityLabel}
        <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </p>
    </article>
  );
}
