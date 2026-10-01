"use client";

import { Button } from "@/components/ui/button";

export default function MarketingError({ reset }: { reset: () => void }) {
  return (
    <section
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
      aria-labelledby="events-error"
    >
      <h1 id="events-error" className="text-2xl font-semibold">
        Events are temporarily unavailable
      </h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        We could not load the event information. Please try again.
      </p>
      <Button type="button" onClick={reset} className="mt-5">
        Try again
      </Button>
    </section>
  );
}
