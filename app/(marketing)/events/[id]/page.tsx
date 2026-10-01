import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/events";
import { formatEventDate } from "@/lib/events/format";
import { RegistrationForm } from "../../registration-form";

export const dynamic = "force-dynamic";

export default async function PublicEventPage({
  params,
}: PageProps<"/events/[id]">) {
  const { id } = await params;
  const event = await getPublicEvent(id);
  if (!event) notFound();

  const closed = event.availability === "closed";
  const waitlist = event.availability === "waitlist";
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/"
        className="text-sm font-medium underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        All events
      </Link>
      <header className="mt-7 border-b border-border pb-8">
        <p className="text-sm font-medium text-muted-foreground">
          {formatEventDate(event.eventDate, true)}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {event.title}
        </h1>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">Location</dt>
            <dd className="mt-1 text-foreground/80">
              {event.location ?? "Location to be confirmed"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              Organizing committee
            </dt>
            <dd className="mt-1 text-foreground/80">{event.committeeName}</dd>
          </div>
        </dl>
      </header>
      <section className="prose prose-neutral dark:prose-invert mt-8 max-w-none">
        <h2>About this event</h2>
        <p className="whitespace-pre-wrap">{event.description}</p>
      </section>
      <section
        aria-labelledby="registration-heading"
        className="mt-10 rounded-xl border border-border bg-surface p-5 shadow-panel sm:p-7"
      >
        <h2 id="registration-heading" className="text-xl font-semibold">
          {closed
            ? "Registration closed"
            : waitlist
              ? "Join the waitlist"
              : "Register for this event"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {closed
            ? "This event has already started. New registrations and waitlist entries are closed."
            : waitlist
              ? "Places are full or being allocated. Joining the waitlist does not confirm a place."
              : "No account is needed. Your name and email are used only for event administration."}
        </p>
        <div className="mt-5">
          <RegistrationForm
            eventId={event.id}
            availability={event.availability}
          />
        </div>
      </section>
    </article>
  );
}
