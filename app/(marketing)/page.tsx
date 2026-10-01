import Link from "next/link";
import { getPublicEventPage, type PublicEvent } from "@/lib/events";
import { formatEventDate } from "@/lib/events/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";
import { CalendarX2 } from "lucide-react";

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
          <p className="text-sm font-medium text-muted-foreground">
            Engineering Society
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {period === "past" ? "Past events" : "Upcoming events"}
          </h1>
          <p className="mt-3 max-w-2xl text-foreground/80">
            Discover workshops and events. Registration uses your name and email
            only; no member account is required.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={period === "past" ? "/" : "/?period=past"}>
            {period === "past" ? "Upcoming events" : "Past events"}
          </Link>
        </Button>
      </div>

      {events.length === 0 ? (
        <StatePanel
          icon={CalendarX2}
          title={`No ${period} events`}
          description={
            period === "past"
              ? "There are no past events to show."
              : "Check back soon for the next event."
          }
          className="mt-10 max-w-none"
        />
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id} className="min-w-0">
              {/* Not variant="interactive" — the card holds two separate
                  links (title, "View event"), not one clickable surface,
                  so a hover-lift/cursor-pointer affordance would mislead. */}
              <Card variant="elevated" className="h-full">
                <CardContent className="flex h-full flex-col">
                  <p className="text-sm text-muted-foreground">
                    {formatEventDate(event.eventDate)}
                  </p>
                  <h2 className="mt-3 text-xl font-semibold">
                    <Link
                      href={`/events/${event.id}`}
                      className="underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                    >
                      {event.title}
                    </Link>
                  </h2>
                  <p className="mt-2 text-sm text-foreground/80">
                    Organized by {event.committeeName}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                  <p className="mt-3 line-clamp-3 text-sm text-foreground/80">
                    {event.description}
                  </p>
                  <p className="mt-4 text-sm font-medium text-foreground">
                    {availabilityCopy(event)}
                  </p>
                  <Button asChild className="mt-4 w-fit">
                    <Link href={`/events/${event.id}`}>View event</Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Button asChild variant="outline" className="mt-8">
          <Link
            href={`/?period=${period}&cursor=${encodeURIComponent(nextCursor)}`}
          >
            More {period} events
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
