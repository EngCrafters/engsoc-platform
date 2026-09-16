"use client";

export default function MarketingError({ reset }: { reset: () => void }) {
  return (
    <section
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
      aria-labelledby="events-error"
    >
      <h1 id="events-error" className="text-2xl font-semibold">
        Events are temporarily unavailable
      </h1>
      <p className="mt-2 max-w-xl text-neutral-700">
        We could not load the event information. Please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded bg-neutral-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Try again
      </button>
    </section>
  );
}
