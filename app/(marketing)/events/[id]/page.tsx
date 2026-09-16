import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedEvent } from "@/lib/events";
import { RegistrationForm } from "../../registration-form";

export const dynamic = "force-dynamic";

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getPublishedEvent(id);
  if (!event) notFound();

  return (
    <article className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm text-neutral-500">
        <Link href="/" className="underline">
          All events
        </Link>
      </p>
      <h1 className="mt-6 text-3xl font-semibold">{event.title}</h1>
      <p className="mt-2 text-sm text-neutral-500">
        {event.eventDate.toLocaleString("en-US", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "Asia/Muscat",
        })}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      {event.description ? (
        <p className="mt-6 whitespace-pre-wrap">{event.description}</p>
      ) : null}
      <section aria-labelledby="registration-heading" className="mt-8">
        <h2 id="registration-heading" className="text-lg font-medium">
          Register for this event
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          No account is needed. If places are full, you can join the waitlist.
        </p>
        <div className="mt-4">
          <RegistrationForm eventId={event.id} showWaitlist />
        </div>
      </section>
    </article>
  );
}
