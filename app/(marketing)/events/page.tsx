import type { Metadata } from "next";
import Link from "next/link";
import { getPublicEventPage } from "@/lib/events";
import { toMarketingEventCard } from "@/lib/marketing/adapters";
import { getI18n } from "@/lib/i18n/server";
import { EventCard } from "@/components/marketing/event-card";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.nav.links.events} — ${t.site.name}` };
}

/**
 * Every published event, upcoming or past.
 *
 * Reads through the canonical public domain module exactly as the landing page
 * does: cursor-paginated, display-only DTO, availability derived in the
 * database. A malformed or mismatched cursor is treated as no cursor.
 */
export default async function EventsPage({
  searchParams,
}: PageProps<"/events">) {
  const query = await searchParams;
  const { t, intl } = await getI18n();
  const period = query.period === "past" ? "past" : "upcoming";
  const { events, nextCursor } = await getPublicEventPage({
    period,
    cursor: typeof query.cursor === "string" ? query.cursor : undefined,
  });
  const cards = events.map((event) => toMarketingEventCard(event, t, intl));

  return (
    <div className="mx-auto max-w-[var(--m-content-max)] px-5 pt-[calc(var(--m-nav-height)+var(--m-nav-offset)+3rem)] pb-20 sm:px-8 sm:pb-24">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-m-border pb-8">
        <h1 className="text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold">
          {period === "past" ? t.events.past : t.events.upcoming}
        </h1>
        <Link
          href={period === "past" ? "/events" : "/events?period=past"}
          className="inline-flex min-h-12 items-center rounded-m-button border border-m-border-strong px-6 font-semibold transition-colors hover:border-m-brand hover:text-m-brand"
        >
          {period === "past" ? t.events.upcoming : t.events.past}
        </Link>
      </div>

      {cards.length === 0 ? (
        <div className="mt-10 rounded-m-card border border-dashed border-m-border-strong bg-m-surface p-8">
          <p className="font-semibold">
            {period === "past" ? t.events.noPast : t.events.noUpcoming}
          </p>
          <p className="mt-2 text-m-ink-2">
            {period === "past" ? t.events.noPastBody : t.events.noUpcomingBody}
          </p>
        </div>
      ) : (
        <ul className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((event) => (
            <li key={event.id} className="relative">
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="mt-10">
          <Link
            href={`/events?period=${period}&cursor=${encodeURIComponent(nextCursor)}`}
            className="inline-flex min-h-12 items-center rounded-m-button border border-m-border-strong px-6 font-semibold transition-colors hover:border-m-brand hover:text-m-brand"
          >
            {period === "past" ? t.events.morePast : t.events.moreUpcoming}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
