"use client";

import { useActionState } from "react";
import { promoteWaitlistAction } from "./actions";

export function PromoteButton({
  eventId,
  registrationId,
}: {
  eventId: string;
  registrationId: string;
}) {
  const [state, action, pending] = useActionState(promoteWaitlistAction, null);
  return (
    <form action={action} className="grid gap-1 justify-items-start">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="registrationId" value={registrationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft/70 disabled:opacity-50"
      >
        {pending ? "Promoting…" : "Promote"}
      </button>
      {state?.code && state.code !== "SUCCESS" ? (
        <span className="text-xs text-danger">
          {state.code === "QUEUE_ORDER_CONFLICT"
            ? "Promote the first waitlisted person."
            : "Could not promote."}
        </span>
      ) : null}
    </form>
  );
}
