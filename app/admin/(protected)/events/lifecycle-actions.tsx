"use client";

import { type ReactNode, useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Globe2,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  type LucideIcon,
} from "lucide-react";
import { lifecycleEventAction } from "./actions";
import { LifecyclePanel } from "@/components/admin/lifecycle-panel";
import { ConfirmTransitionDialog } from "@/components/admin/confirm-transition-dialog";
import { ConflictAlert } from "@/components/admin/conflict-alert";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { EventLifecycleStatus } from "@/lib/admin-events/status";
import { DURATION, EASE_OUT } from "@/lib/motion/variants";
import { cn } from "@/lib/utils";
import { adminErrorMessage } from "@/lib/admin-errors";

type Props = {
  eventId: string;
  revision: number;
  status: "draft" | "published" | "full";
  archived: boolean;
  reviewRequired: boolean;
  isFlagger: boolean;
  isApproved: boolean;
  isPast: boolean;
  lifecycleStatus: EventLifecycleStatus;
};

const LIFECYCLE_FORM_ID = "lifecycle-form";

function Action({
  operation,
  icon: Icon,
  disabled,
  hint,
  children,
}: {
  operation: string;
  icon: LucideIcon;
  disabled?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <button
        type="submit"
        name="operation"
        value={operation}
        disabled={disabled}
        className={cn(
          "group flex min-h-12 w-full items-center gap-3 rounded-lg border px-3.5 text-left text-sm font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] disabled:pointer-events-none disabled:border-border/60 disabled:bg-muted/50 disabled:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          operation === "publish_event" || operation === "reopen_event"
            ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
            : "border-border bg-surface hover:border-primary/30 hover:bg-primary-soft/40"
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 group-disabled:text-muted-foreground",
            operation === "publish_event" || operation === "reopen_event"
              ? "text-primary-foreground"
              : "text-muted-foreground group-hover:text-primary"
          )}
        />
        {children}
      </button>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function LifecycleActions(props: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState(lifecycleEventAction, null);
  const canArchive =
    !props.archived && (props.status === "draft" || props.isPast);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.code && state.code !== "SUCCESS") feedbackRef.current?.focus();
    if (state?.code === "SUCCESS") {
      toast.success("Lifecycle change saved", {
        description: "The latest event state is shown.",
        id: `event-lifecycle-${props.eventId}`,
      });
      router.refresh();
    }
  }, [router, state, props.eventId]);

  return (
    <section
      className="mt-10 border-t border-border pt-8"
      aria-labelledby="lifecycle-title"
    >
      <div className="max-w-3xl">
        <p className="text-xs font-medium text-muted-foreground">Lifecycle</p>
        <h2
          id="lifecycle-title"
          className="mt-1 text-xl font-semibold tracking-tight"
        >
          Lifecycle & publication
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Review and publication actions apply to the saved event revision.
          Unavailable actions explain their requirements below.
        </p>
      </div>

      <div className="mt-6 max-w-3xl overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
        <LifecyclePanel
          status={props.lifecycleStatus}
          reviewRequired={props.reviewRequired}
          isFlagger={props.isFlagger}
          isApproved={props.isApproved}
        />
        <form
          id={LIFECYCLE_FORM_ID}
          action={action}
          className="grid gap-3 px-5 py-5 sm:px-6"
        >
          <input type="hidden" name="eventId" value={props.eventId} />
          <input type="hidden" name="revision" value={props.revision} />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Next actions
          </p>
          {props.archived ? (
            <Action operation="restore_event" icon={ArchiveRestore}>
              Restore event
            </Action>
          ) : (
            <>
              <p className="mt-1 border-t border-border pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Review
              </p>
              <Action
                operation={
                  props.reviewRequired ? "unflag_review" : "flag_review"
                }
                icon={props.reviewRequired ? ShieldOff : ShieldQuestion}
                disabled={props.status !== "draft"}
                hint={
                  props.status !== "draft"
                    ? "Review requirement can only be changed while the event is a draft."
                    : undefined
                }
              >
                {props.reviewRequired
                  ? "Remove review requirement"
                  : "Require second-manager review"}
              </Action>
              {props.reviewRequired ? (
                <Action
                  operation="approve_event"
                  icon={ShieldCheck}
                  disabled={props.isFlagger || props.isApproved}
                  hint={
                    props.isFlagger
                      ? "A different active manager must approve this revision."
                      : props.isApproved
                        ? "This revision is approved."
                        : undefined
                  }
                >
                  Approve current revision
                </Action>
              ) : null}
              <p className="mt-2 border-t border-border pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Publication and registration
              </p>
              {props.status === "draft" || props.status === "full" ? (
                <Action
                  operation={
                    props.status === "full" ? "reopen_event" : "publish_event"
                  }
                  icon={props.status === "full" ? RotateCcw : Globe2}
                  disabled={props.isPast}
                  hint={
                    props.isPast
                      ? "Past events cannot be published or reopened."
                      : undefined
                  }
                >
                  {props.status === "full"
                    ? "Reopen registration"
                    : "Publish event"}
                </Action>
              ) : null}
              {props.status === "published" ? (
                <Action
                  operation="hold_event_full"
                  icon={Ban}
                  disabled={props.isPast}
                  hint={
                    props.isPast
                      ? "Past events cannot manually be held full."
                      : undefined
                  }
                >
                  Mark registration full
                </Action>
              ) : null}
              <p className="mt-2 border-t border-border pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Archive
              </p>
              <ConfirmTransitionDialog
                formId={LIFECYCLE_FORM_ID}
                operation="archive_event"
                destructive
                title="Archive this event?"
                description="Archived events leave the default committee workspace view. You can restore this event at any time from its archived state."
                confirmLabel="Archive event"
                trigger={
                  <div className="grid gap-1">
                    <button
                      type="button"
                      disabled={!canArchive}
                      className="group flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3.5 text-left text-sm font-medium transition-[background-color,border-color,transform] duration-150 hover:border-danger/30 hover:bg-danger-soft/40 active:scale-[0.99] disabled:pointer-events-none disabled:border-border/60 disabled:bg-muted/50 disabled:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Archive
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground group-hover:text-danger group-disabled:text-muted-foreground"
                      />
                      Archive event
                    </button>
                    {!canArchive ? (
                      <p className="text-xs text-muted-foreground">
                        Draft events and past events can be archived.
                      </p>
                    ) : null}
                  </div>
                }
              />
            </>
          )}
        </form>
      </div>

      <div
        ref={feedbackRef}
        tabIndex={-1}
        className="mt-4 max-w-3xl outline-none"
      >
        <AnimatePresence mode="wait">
          {pending ? (
            <motion.p
              key="pending"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast }}
              className="text-sm text-muted-foreground"
              aria-live="polite"
            >
              Applying lifecycle change…
            </motion.p>
          ) : state?.code === "CONFLICT" ? (
            <ConflictAlert key="conflict" onReload={() => router.refresh()} />
          ) : state?.code && state.code !== "SUCCESS" ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DURATION.normal, ease: EASE_OUT }}
            >
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t apply that change</AlertTitle>
                <AlertDescription>
                  {adminErrorMessage(state.code)}
                </AlertDescription>
              </Alert>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
