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
import { Button } from "@/components/ui/button";
import type { EventLifecycleStatus } from "@/lib/admin-events/status";
import { DURATION, EASE_OUT } from "@/lib/motion/variants";
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
  primary = false,
  children,
}: {
  operation: string;
  icon: LucideIcon;
  disabled?: boolean;
  hint?: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="submit"
        name="operation"
        value={operation}
        disabled={disabled}
        variant={primary ? "default" : "outline"}
      >
        <Icon aria-hidden="true" data-icon="inline-start" />
        {children}
      </Button>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-6 first:pt-0 last:pb-0 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid min-w-0 gap-4">{children}</div>
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
      className="flex max-w-4xl flex-col gap-6"
      aria-labelledby="lifecycle-title"
    >
      <div>
        <h2 id="lifecycle-title" className="text-lg font-semibold">
          Lifecycle & publication
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and publication actions apply to the saved event revision.
          Unavailable actions explain their requirements.
        </p>
      </div>

      <LifecyclePanel
        status={props.lifecycleStatus}
        reviewRequired={props.reviewRequired}
        isFlagger={props.isFlagger}
        isApproved={props.isApproved}
      />

      <form
        id={LIFECYCLE_FORM_ID}
        action={action}
        className="flex flex-col divide-y"
      >
        <input type="hidden" name="eventId" value={props.eventId} />
        <input type="hidden" name="revision" value={props.revision} />
        {props.archived ? (
          <Group title="Restore">
            <Action operation="restore_event" icon={ArchiveRestore}>
              Restore event
            </Action>
          </Group>
        ) : (
          <>
            <Group title="Review">
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
            </Group>
            {props.status === "draft" ||
            props.status === "full" ||
            props.status === "published" ? (
              <Group title="Publication and registration">
                {props.status === "draft" || props.status === "full" ? (
                  <Action
                    operation={
                      props.status === "full" ? "reopen_event" : "publish_event"
                    }
                    icon={props.status === "full" ? RotateCcw : Globe2}
                    primary
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
              </Group>
            ) : null}
            <Group title="Archive">
              <ConfirmTransitionDialog
                formId={LIFECYCLE_FORM_ID}
                operation="archive_event"
                destructive
                title="Archive this event?"
                description="Archived events leave the default committee workspace view. You can restore this event at any time from its archived state."
                confirmLabel="Archive event"
                trigger={
                  <div className="flex flex-col items-start gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canArchive}
                    >
                      <Archive aria-hidden="true" data-icon="inline-start" />
                      Archive event
                    </Button>
                    {!canArchive ? (
                      <p className="text-xs text-muted-foreground">
                        Draft events and past events can be archived.
                      </p>
                    ) : null}
                  </div>
                }
              />
            </Group>
          </>
        )}
      </form>

      <div ref={feedbackRef} tabIndex={-1} className="outline-none">
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
