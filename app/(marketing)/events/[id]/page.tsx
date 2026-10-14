import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEvent } from "@/lib/events";
import { formatEventDate } from "@/lib/marketing/adapters";
import { getI18n } from "@/lib/i18n/server";
import { IconCalendar, IconPin } from "@/components/marketing/icons";
import { RegistrationForm } from "../../registration-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/events/[id]">): Promise<Metadata> {
  const { id } = await params;
  const event = await getPublicEvent(id);
  if (!event) return {};
  return { title: event.title, description: event.description };
}

/**
 * One public event and its registration form.
 *
 * A draft, archived or nonexistent event, and a malformed id, all resolve to
 * the same 404 — the canonical public domain module decides that before any
 * data reaches this page.
 */
export default async function PublicEventPage({
  params,
}: PageProps<"/events/[id]">) {
  const { id } = await params;
  const event = await getPublicEvent(id);
  if (!event) notFound();

  const { t, intl } = await getI18n();

  return (
    <article className="mx-auto max-w-[var(--m-content-max)] px-5 pt-[calc(var(--m-nav-height)+var(--m-nav-offset)+2.5rem)] pb-20 sm:px-8 sm:pb-24">
      <Link
        href="/events"
        className="inline-flex min-h-11 items-center text-sm font-medium text-m-ink-2 underline underline-offset-4 hover:text-m-brand"
      >
        {t.events.backToEvents}
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <header className="border-b border-m-border pb-8">
            <p className="flex items-center gap-2 text-sm font-medium text-m-brand">
              <IconCalendar className="size-4" />
              <time dateTime={event.eventDate.toISOString()}>
                {formatEventDate(event.eventDate, intl, true)}
              </time>
            </p>
            <h1 className="mt-4 text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold">
              {event.title}
            </h1>
            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">{t.events.location}</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-m-ink-2">
                  <IconPin className="size-4" />
                  {event.location ?? t.events.locationTbc}
                </dd>
              </div>
              <div>
                <dt className="font-medium">{t.events.organisedBy}</dt>
                <dd className="mt-1 text-m-ink-2">{event.committeeName}</dd>
              </div>
            </dl>
          </header>

          <section aria-labelledby="about-event" className="mt-8">
            <h2 id="about-event" className="text-xl font-semibold">
              {t.events.aboutEvent}
            </h2>
            <p className="mt-4 max-w-[var(--m-measure)] whitespace-pre-wrap text-m-ink-2">
              {event.description}
            </p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-[calc(var(--m-nav-height)+var(--m-nav-offset)+1.5rem)] lg:self-start">
          <RegistrationForm
            availability={event.availability}
            eventId={event.id}
          />
        </aside>
      </div>
    </article>
  );
}
