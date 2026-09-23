"use client";

import { useActionState } from "react";
import { promoteWaitlistAction } from "./actions";
import { adminErrorMessage } from "@/lib/admin-errors";

export function PromoteButton({
  eventId,
  registrationId,
}: {
  eventId: string;
  registrationId: string;
}) {
  const [state, action, pending] = useActionState(promoteWaitlistAction, null);
  return (
    <form
      action={action}
      className="grid w-full gap-1 sm:w-48 sm:justify-self-end"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="registrationId" value={registrationId} />
      <div className="flex min-h-8 justify-start sm:justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft/70 disabled:opacity-50"
        >
          {pending ? "Promoting…" : "Promote"}
        </button>
      </div>
      <span
        role={state?.code && state.code !== "SUCCESS" ? "alert" : undefined}
        aria-live="polite"
        className="min-h-8 w-full text-right text-xs leading-4 text-danger"
      >
        {state?.code && state.code !== "SUCCESS"
          ? adminErrorMessage(state.code)
          : ""}
      </span>
    </form>
  );
}
