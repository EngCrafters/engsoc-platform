"use client";

import { useActionState, useEffect, useRef } from "react";
import { registerForEventAction } from "./actions";
import { initialRegisterActionState } from "./action-state";
import type { RegisterForEventError } from "@/lib/registrations";
import type { PublicEventAvailability } from "@/lib/events";

const ERROR_MESSAGES: Record<RegisterForEventError, string> = {
  invalid_name: "Enter your name.",
  invalid_email: "Enter a valid email address.",
  invalid_event: "This event is unavailable.",
  event_not_found: "This event is unavailable.",
  event_not_published: "This event is unavailable.",
  event_full:
    "Registration is full or places are being allocated to the waitlist.",
  rate_limited:
    "Too many attempts from this connection. Try again after 10 minutes.",
  already_registered:
    "This email is already registered for this event. No second registration was created.",
  already_waitlisted:
    "This email is already on the waitlist. No second entry was created.",
  registration_closed:
    "Registration has closed because this event has started.",
  invalid_intent: "Choose a valid registration option.",
  invalid_ip: "We couldn't verify this request. Try again.",
  invalid_input: "Check the form and try again.",
  server_error:
    "We couldn't confirm the result. Try again; retrying won't create another entry.",
  registration_available:
    "Registration is open again. Choose Register to confirm your place.",
};

export function RegistrationForm({
  eventId,
  availability,
}: {
  eventId: string;
  availability: PublicEventAvailability;
}) {
  const [state, formAction, isPending] = useActionState(
    registerForEventAction,
    initialRegisterActionState
  );
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error") errorSummary.current?.focus();
  }, [state]);

  if (state.status === "success")
    return (
      <p
        role="status"
        className="rounded border border-green-700 bg-green-50 p-4 text-sm font-medium text-green-900"
      >
        {state.waitlisted
          ? "You're on the waitlist, not yet registered for a place. The committee will contact you if a place can be offered."
          : "You're registered. Your place is confirmed."}
      </p>
    );
  if (availability === "closed")
    return (
      <button
        type="button"
        disabled
        className="min-h-11 rounded bg-neutral-300 px-4 text-sm font-medium text-neutral-700"
      >
        Registration closed
      </button>
    );

  const error = state.status === "error" ? state.error : null;
  const showWaitlist = availability === "waitlist" || error === "event_full";
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="eventId" value={eventId} />
      {state.status === "error" ? (
        <div
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {ERROR_MESSAGES[state.error]}
        </div>
      ) : null}
      <div>
        <label htmlFor="attendeeName" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="attendeeName"
          name="attendeeName"
          autoComplete="name"
          required
          maxLength={200}
          aria-invalid={error === "invalid_name"}
          aria-describedby={
            error === "invalid_name" ? "attendeeName-error" : undefined
          }
          className="mt-1 min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        />
        {error === "invalid_name" ? (
          <p id="attendeeName-error" className="mt-1 text-sm text-red-700">
            {ERROR_MESSAGES.invalid_name}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="attendeeEmail" className="block text-sm font-medium">
          Email address
        </label>
        <input
          id="attendeeEmail"
          name="attendeeEmail"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error === "invalid_email"}
          aria-describedby={
            error === "invalid_email" ? "attendeeEmail-error" : undefined
          }
          className="mt-1 min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        />
        {error === "invalid_email" ? (
          <p id="attendeeEmail-error" className="mt-1 text-sm text-red-700">
            {ERROR_MESSAGES.invalid_email}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        name="intent"
        value={showWaitlist ? "join_waitlist" : "register"}
        disabled={isPending}
        className="inline-flex min-h-11 w-fit items-center rounded bg-neutral-900 px-4 text-sm font-medium text-white transition-transform duration-150 ease-out motion-reduce:transition-none hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending
          ? "Submitting…"
          : showWaitlist
            ? "Join waitlist"
            : "Register"}
      </button>
      <p aria-live="polite" className="sr-only">
        {isPending ? "Submitting registration" : ""}
      </p>
    </form>
  );
}
