"use client";

import { useActionState, useEffect, useRef } from "react";
import { registerForEventAction } from "./actions";
import { initialRegisterActionState } from "./action-state";
import type { RegisterForEventError } from "@/lib/registrations";
import type { PublicEventAvailability } from "@/lib/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MessageBanner } from "@/components/ui/message-banner";
import { FormActions, FormField } from "@/components/ui/form-field";

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
      <MessageBanner tone="success">
        {state.waitlisted
          ? "You're on the waitlist, not yet registered for a place. The committee will contact you if a place can be offered."
          : "You're registered. Your place is confirmed."}
      </MessageBanner>
    );
  if (availability === "closed")
    return (
      <Button type="button" disabled className="h-10">
        Registration closed
      </Button>
    );

  const error = state.status === "error" ? state.error : null;
  const showWaitlist = availability === "waitlist" || error === "event_full";
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="eventId" value={eventId} />
      {state.status === "error" ? (
        <MessageBanner ref={errorSummary} tabIndex={-1} tone="error">
          {ERROR_MESSAGES[state.error]}
        </MessageBanner>
      ) : null}
      <FormField
        htmlFor="attendeeName"
        label="Name"
        error={
          error === "invalid_name" ? ERROR_MESSAGES.invalid_name : undefined
        }
      >
        <Input
          id="attendeeName"
          name="attendeeName"
          autoComplete="name"
          required
          maxLength={200}
          aria-invalid={error === "invalid_name"}
          aria-describedby={
            error === "invalid_name" ? "attendeeName-error" : undefined
          }
          className="h-10"
        />
      </FormField>
      <FormField
        htmlFor="attendeeEmail"
        label="Email address"
        error={
          error === "invalid_email" ? ERROR_MESSAGES.invalid_email : undefined
        }
      >
        <Input
          id="attendeeEmail"
          name="attendeeEmail"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error === "invalid_email"}
          aria-describedby={
            error === "invalid_email" ? "attendeeEmail-error" : undefined
          }
          className="h-10"
        />
      </FormField>
      <FormActions>
        <Button
          type="submit"
          name="intent"
          value={showWaitlist ? "join_waitlist" : "register"}
          disabled={isPending}
          className="h-10 w-fit"
        >
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {isPending
            ? "Submitting…"
            : showWaitlist
              ? "Join waitlist"
              : "Register"}
        </Button>
      </FormActions>
      <p aria-live="polite" className="sr-only">
        {isPending ? "Submitting registration" : ""}
      </p>
    </form>
  );
}
