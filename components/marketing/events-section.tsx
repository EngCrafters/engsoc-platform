import Link from "next/link";
import { getPublicEventPage } from "@/lib/events";
import { toMarketingEventCard } from "@/lib/marketing/adapters";
import { getI18n } from "@/lib/i18n/server";
import { EventCard } from "./event-card";
import { IconArrowRight } from "./icons";

/**
 * The landing page's events section.
 *
 * Reads live published events through the canonical public domain module. There
 * is no sample data here: if the database has no published events, the section
 * says so plainly rather than showing placeholders.
 */
export async function EventsSection() {
  const { t, intl } = await getI18n();
  const { events } = await getPublicEventPage({ period: "upcoming" });
  const preview = events
    .slice(0, 3)
    .map((event) => toMarketingEventCard(event, t, intl));

  return (
    <section
      id="events"
      aria-labelledby="events-title"
      className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2
          id="events-title"
          className="max-w-[20ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
        >
          {t.events.title}
        </h2>
        <Link
          href="/events"
          className="inline-flex min-h-12 items-center gap-2 rounded-m-button border border-m-border-strong px-6 font-semibold transition-colors hover:border-m-brand hover:text-m-brand"
        >
          {t.events.viewAll}
          <IconArrowRight className="size-4" />
        </Link>
      </div>

      {preview.length === 0 ? (
        <div className="mt-10 rounded-m-card border border-dashed border-m-border-strong bg-m-surface p-8">
          <p className="font-semibold">{t.events.noUpcoming}</p>
          <p className="mt-2 text-m-ink-2">{t.events.noUpcomingBody}</p>
        </div>
      ) : (
        <ul className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {preview.map((event) => (
            <li key={event.id} className="relative">
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
