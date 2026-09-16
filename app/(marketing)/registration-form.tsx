"use client";

// The registration form is a client component (it needs useActionState for
// pending/error UI) that posts straight to the Server Action in
// ./actions.ts — no fetch(), no API route.

import { useActionState } from "react";
import { registerForEventAction, initialRegisterActionState } from "./actions";
import type { RegisterForEventError } from "@/lib/registrations";

const ERROR_MESSAGES: Record<RegisterForEventError, string> = {
  invalid_name: "Enter your name.",
  invalid_email: "Enter a valid email address.",
  invalid_event: "Something went wrong — refresh and try again.",
  event_not_found: "This event no longer exists.",
  event_not_published: "This event isn't open for registration yet.",
  event_full: "This event is full.",
  rate_limited:
    "Too many attempts from this connection — try again in a few minutes.",
  already_registered: "This email is already registered for this event.",
  already_waitlisted: "This email is already on the waitlist for this event.",
  registration_closed:
    "Registration has closed because this event has started.",
  invalid_intent: "Choose a valid registration option.",
  invalid_ip: "We couldn't verify this request. Try again.",
  invalid_input: "Check the form and try again.",
  server_error: "We couldn't confirm the result. Try again.",
};

export function RegistrationForm({ eventId }: { eventId: string }) {
  const [state, formAction, isPending] = useActionState(
    registerForEventAction,
    initialRegisterActionState
  );

  if (state.status === "success") {
    return (
      <p className="text-sm font-medium text-green-700">
        {state.waitlisted
          ? "You’re on the waitlist — the committee will contact you if a place opens."
          : "You&apos;re registered — see you there!"}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input
        name="attendeeName"
        placeholder="Your name"
        required
        maxLength={200}
        className="rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      <input
        name="attendeeEmail"
        type="email"
        placeholder="you@example.com"
        required
        className="rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Registering…" : "Register"}
      </button>
      {state.status === "error" ? (
        <p className="text-sm text-red-600 sm:basis-full">
          {ERROR_MESSAGES[state.error]}
        </p>
      ) : null}
    </form>
  );
}
