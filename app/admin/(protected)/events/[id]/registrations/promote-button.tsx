"use client";

import { useActionState } from "react";
import { ArrowUpCircle } from "lucide-react";
import { promoteWaitlistAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { adminErrorMessage } from "@/lib/admin-errors";

export function PromoteButton({
  eventId,
  registrationId,
}: {
  eventId: string;
  registrationId: string;
}) {
  const [state, action, pending] = useActionState(promoteWaitlistAction, null);
  const failed = Boolean(state?.code && state.code !== "SUCCESS");
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="registrationId" value={registrationId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <ArrowUpCircle aria-hidden="true" data-icon="inline-start" />
        )}
        {pending ? "Promoting…" : "Promote"}
      </Button>
      <span
        role={failed ? "alert" : undefined}
        aria-live="polite"
        className="max-w-56 text-right text-xs text-destructive empty:hidden"
      >
        {failed && state?.code ? adminErrorMessage(state.code) : ""}
      </span>
    </form>
  );
}
