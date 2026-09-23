import { ShieldAlert, ShieldCheck } from "lucide-react";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import {
  EVENT_STATUS_META,
  type EventLifecycleStatus,
} from "@/lib/admin-events/status";

/**
 * The current-state half of the lifecycle experience: a status hero plus
 * the review/approval sub-state. Deliberately not a linear step timeline —
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
    <div className="border-b border-border px-5 py-5 sm:px-6">
      <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Current state
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <EventStatusBadge
          status={status}
          className="h-6 px-2.5 text-[0.8rem]"
        />
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </div>
      {reviewRequired &&
      (status === "draft" || status === "review" || status === "approved") ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-warning-soft/60 px-3.5 py-3 text-sm text-warning-soft-foreground">
          {isApproved ? (
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
          ) : (
            <ShieldAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
          )}
          <p className="leading-5">
            {isApproved
              ? "A different manager approved this revision. It can be published."
              : isFlagger
                ? "You flagged this revision for review. A different active manager on this committee must approve it before it can publish."
                : "This revision needs approval from a different active manager on this committee before it can publish."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
