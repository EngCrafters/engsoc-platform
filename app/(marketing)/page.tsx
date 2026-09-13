// Landing page — UC-02's public events page. A Server Component that calls
// lib/events' getPublishedEvents() directly, no fetch() or API route in
// between. This is the actual point of putting the marketing site in this
// repo instead of a separate one.

import { getPublishedEvents } from "@/lib/events";
import { RegistrationForm } from "./registration-form";

// Without this, Next.js would statically prerender this page at build
// time (a raw DB call isn't detected as dynamic the way fetch()/cookies()
// are) and bake in whatever events existed at that moment — directly
// against UC-02's "event appears live on the public events page." Force
// per-request rendering instead.
export const dynamic = "force-dynamic";

export default async function MarketingHomePage() {
  const events = await getPublishedEvents();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Upcoming events</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Register with just your name and email — no account needed.
      </p>

      {events.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">
          Nothing published yet. Check back soon.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-6">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-lg border border-neutral-200 p-4"
            >
              <h2 className="font-medium">{event.title}</h2>
              <p className="text-sm text-neutral-500">
                {event.eventDate.toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {event.location ? ` · ${event.location}` : ""}
              </p>
              {event.description ? (
                <p className="mt-2 text-sm">{event.description}</p>
              ) : null}
              <div className="mt-4">
                <RegistrationForm eventId={event.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
