import Link from "next/link";
import { getPublicEventPage, type PublicEvent } from "@/lib/events";
import { formatEventDate } from "@/lib/events/format";

export const dynamic = "force-dynamic";

function availabilityCopy(event: PublicEvent) {
  if (event.availability === "waitlist") return "Full — join the waitlist";
  if (event.availability === "closed") return "Registration closed";
  return "Registration open";
}

export default async function MarketingHomePage({
  searchParams,
}: PageProps<"/">) {
  const query = await searchParams;
  const period = query.period === "past" ? "past" : "upcoming";
  const { events, nextCursor } = await getPublicEventPage({
    period,
    cursor: typeof query.cursor === "string" ? query.cursor : undefined,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-600">
            Engineering Society
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {period === "past" ? "Past events" : "Upcoming events"}
          </h1>
          <p className="mt-3 max-w-2xl text-neutral-700">
            Discover workshops and events. Registration uses your name and email
            only; no member account is required.
          </p>
        </div>
        <Link
          href={period === "past" ? "/" : "/?period=past"}
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          {period === "past" ? "Upcoming events" : "Past events"}
        </Link>
      </div>

      {events.length === 0 ? (
        <section
          className="mt-10 rounded-xl border border-dashed border-neutral-300 p-8 text-center"
          aria-labelledby="empty-events"
        >
          <h2 id="empty-events" className="text-lg font-semibold">
            No {period} events
          </h2>
          <p className="mt-2 text-neutral-700">
            {period === "past"
              ? "There are no past events to show."
              : "Check back soon for the next event."}
          </p>
        </section>
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-shadow motion-reduce:transition-none hover:shadow-md"
            >
              <p className="text-sm text-neutral-600">
                {formatEventDate(event.eventDate)}
              </p>
              <h2 className="mt-3 text-xl font-semibold">
                <Link
                  href={`/events/${event.id}`}
                  className="underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900"
                >
                  {event.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm text-neutral-700">
                Organized by {event.committeeName}
                {event.location ? ` · ${event.location}` : ""}
              </p>
              <p className="mt-3 line-clamp-3 text-sm text-neutral-700">
                {event.description}
              </p>
              <p className="mt-4 text-sm font-medium text-neutral-900">
                {availabilityCopy(event)}
              </p>
              <Link
                href={`/events/${event.id}`}
                className="mt-4 inline-flex min-h-11 items-center rounded bg-neutral-900 px-4 text-sm font-medium text-white transition-transform duration-150 ease-out motion-reduce:transition-none hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 active:scale-[0.98]"
              >
                View event
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Link
          href={`/?period=${period}&cursor=${encodeURIComponent(nextCursor)}`}
          className="mt-8 inline-flex min-h-11 items-center rounded border border-neutral-300 px-4 text-sm font-medium hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          More {period} events
        </Link>
      ) : null}
    </div>
  );
}
