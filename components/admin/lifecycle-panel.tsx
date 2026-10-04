import { ShieldAlert, ShieldCheck } from "lucide-react";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  EVENT_STATUS_META,
  type EventLifecycleStatus,
} from "@/lib/admin-events/status";

/**
 * The current-state half of the lifecycle experience: the status plus the
 * review/approval sub-state. Deliberately not a linear step timeline —
 * the real transition graph branches (published <-> full, any live state
 * -> archived -> restore), so a fixed step sequence would imply
 * transitions the app_runtime routines don't actually allow.
 */
export function LifecyclePanel({
  status,
  reviewRequired,
  isFlagger,
  isApproved,
}: {
  status: EventLifecycleStatus;
  reviewRequired: boolean;
  isFlagger: boolean;
  isApproved: boolean;
}) {
  const meta = EVENT_STATUS_META[status];
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm font-medium">Current state</p>
        <EventStatusBadge status={status} />
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </div>
      {reviewRequired &&
      (status === "draft" || status === "review" || status === "approved") ? (
        <Alert>
          {isApproved ? (
            <ShieldCheck aria-hidden="true" />
          ) : (
            <ShieldAlert aria-hidden="true" />
          )}
          <AlertDescription>
            {isApproved
              ? "Board Administration or Technical Team approved this revision. It can be published."
              : isFlagger
                ? "You flagged this revision for review. A different Board Administration or Technical Team user must approve it before publication."
                : "This revision needs approval from a different Board Administration or Technical Team user before publication."}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
