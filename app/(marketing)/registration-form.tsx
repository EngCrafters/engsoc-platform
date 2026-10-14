"use client";

import { useActionState, useEffect, useRef } from "react";
import { registerForEventAction } from "./actions";
import { initialRegisterActionState } from "./action-state";
import type { PublicEventAvailability } from "@/lib/events";
import { useI18n } from "@/components/marketing/i18n-provider";

/**
 * The public registration form.
 *
 * Presentation only. The submission goes to the canonical Server Action, which
 * validates and then calls private.register_for_event through the restricted
 * runtime role — so duplicate prevention, capacity, the FIFO waitlist, the IP
 * rate limit and the audit row are all exactly what they were before this
 * migration. Nothing about that contract is reimplemented here.
 *
 * The only fields ever sent are eventId, attendeeName, attendeeEmail and
 * intent; the action rejects anything else.
 */
export function RegistrationForm({
  eventId,
  availability,
}: {
  eventId: string;
  availability: PublicEventAvailability;
}) {
  const { t } = useI18n();
  const [state, formAction, isPending] = useActionState(
    registerForEventAction,
    initialRegisterActionState
  );
  const alertRef = useRef<HTMLParagraphElement>(null);
  const error = state.status === "error" ? state.error : null;

  // Move focus to the message so a keyboard or screen-reader user is told what
  // happened without hunting for it.
  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);

  const closed = availability === "closed";
  const showWaitlist = availability === "waitlist" || error === "event_full";

  return (
    <section
      aria-labelledby="registration-heading"
      className="rounded-m-card border border-m-border bg-m-surface p-6 sm:p-7"
    >
      <h2 id="registration-heading" className="text-xl font-semibold">
        {closed
          ? t.registration.headingClosed
          : showWaitlist
            ? t.registration.headingWaitlist
            : t.registration.heading}
      </h2>
      <p className="mt-2 text-sm text-m-ink-2">
        {closed
          ? t.registration.introClosed
          : showWaitlist
            ? t.registration.introWaitlist
            : t.registration.intro}
      </p>

      <div className="mt-5">
        {state.status === "success" ? (
          <p
            role="status"
            className="rounded-m-button border border-m-border bg-m-brand-soft p-4 text-sm text-m-ink"
          >
            {state.waitlisted
              ? t.registration.successWaitlisted
              : t.registration.successConfirmed}
          </p>
        ) : closed ? (
          <button
            type="button"
            disabled
            className="min-h-12 w-full rounded-m-button border border-m-border bg-m-surface-soft px-5 font-semibold text-m-ink-2"
          >
            {t.registration.headingClosed}
          </button>
        ) : (
          <form action={formAction} className="grid gap-4" noValidate>
            <input type="hidden" name="eventId" value={eventId} />

            {/* The alert is the focus target. Moving focus to a wrapper around it
                would leave the announcement unfocused for anyone navigating by
                keyboard or screen reader. */}
            {error ? (
              <p
                ref={alertRef}
                tabIndex={-1}
                role="alert"
                className="rounded-m-button border border-m-logo-red/40 bg-m-surface-soft p-3 text-sm text-m-ink outline-none"
              >
                {t.registration.errors[error]}
              </p>
            ) : null}

            <div className="grid gap-2">
              <label htmlFor="attendeeName" className="text-sm font-medium">
                {t.registration.name}
              </label>
              <input
                id="attendeeName"
                name="attendeeName"
                autoComplete="name"
                required
                maxLength={200}
                aria-invalid={error === "invalid_name"}
                className="min-h-12 rounded-m-button border border-m-border bg-m-surface px-4 text-base"
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="attendeeEmail" className="text-sm font-medium">
                {t.registration.email}
              </label>
              <input
                id="attendeeEmail"
                name="attendeeEmail"
                type="email"
                autoComplete="email"
                required
                aria-invalid={error === "invalid_email"}
                className="min-h-12 rounded-m-button border border-m-border bg-m-surface px-4 text-base"
              />
            </div>

            <button
              type="submit"
              name="intent"
              value={showWaitlist ? "join_waitlist" : "register"}
              disabled={isPending}
              className="min-h-12 rounded-m-button bg-m-brand px-5 font-semibold text-white transition-colors hover:bg-m-brand-hover disabled:opacity-60"
            >
              {isPending
                ? t.registration.submitting
                : showWaitlist
                  ? t.registration.joinWaitlist
                  : t.registration.register}
            </button>

            <p aria-live="polite" className="sr-only">
              {isPending ? t.registration.submittingSr : ""}
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
