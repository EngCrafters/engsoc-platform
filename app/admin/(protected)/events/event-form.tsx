"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  AlignLeft,
  Building2,
  CalendarClock,
  Info,
  Save,
  Ticket,
  Type,
  Users,
} from "lucide-react";
import { saveEventAction } from "./actions";
import { EventFormSection } from "@/components/admin/event-form-section";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import { ConflictAlert } from "@/components/admin/conflict-alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DURATION, EASE_OUT } from "@/lib/motion/variants";
import type { EventLifecycleStatus } from "@/lib/admin-events/status";
import { adminErrorMessage } from "@/lib/admin-errors";

type EventValues = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  location: string | null;
  capacity: number | null;
  revision: number;
  committeeId: string;
  reviewRequired: boolean;
  approvedBy: string | null;
  confirmedCount: number;
  waitlistedCount: number;
};

function muscatDateTimeValue(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function EventForm({
  committees,
  event,
  eventStatus,
}: {
  committees: readonly { id: string; name: string }[];
  event?: EventValues;
  eventStatus?: EventLifecycleStatus;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (_: unknown, form: FormData) => saveEventAction(form),
    null
  );
  const [committeeId, setCommitteeId] = useState(committees[0]?.id ?? "");
  const [hasCapacityLimit, setHasCapacityLimit] = useState(
    event ? event.capacity !== null : false
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const archived = eventStatus === "archived";
  const past = eventStatus === "past";

  useEffect(() => {
    if (state?.code && state.code !== "SUCCESS") errorRef.current?.focus();
    if (state?.code === "SUCCESS") {
      toast.success("Event changes saved", {
        description: "The latest event details are shown.",
        id: `event-save-${event?.id ?? "new"}`,
      });
      router.refresh();
    }
  }, [router, state, event?.id]);

  return (
    <form
      action={action}
      className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]"
      noValidate
    >
      {event ? (
        <>
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="revision" value={event.revision} />
        </>
      ) : (
        <input type="hidden" name="committeeId" value={committeeId} />
      )}

      <div className="grid min-w-0 gap-5 xl:order-1">
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <AnimatePresence>
            {state?.code === "CONFLICT" ? (
              <ConflictAlert onReload={() => window.location.reload()} />
            ) : state?.code && state.code !== "SUCCESS" ? (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: DURATION.normal, ease: EASE_OUT }}
              >
                <Alert variant="destructive">
                  <AlertTitle>Couldn&apos;t save this event</AlertTitle>
                  <AlertDescription>
                    {adminErrorMessage(state.code)}
                  </AlertDescription>
                </Alert>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <EventFormSection
          icon={Type}
          title="Event basics"
          description="Give visitors a clear name and description."
        >
          {!event ? (
            <div className="grid gap-1.5">
              <Label htmlFor="event-committee">
                <Building2
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
                Committee
              </Label>
              <Select value={committeeId} onValueChange={setCommitteeId}>
                <SelectTrigger id="event-committee" className="h-11 w-full">
                  <SelectValue placeholder="Choose a committee" />
                </SelectTrigger>
                <SelectContent>
                  {committees.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only committees where you are an active manager are shown.
              </p>
            </div>
          ) : null}
          <FormField htmlFor="event-title" label="Title" required>
            <Input
              id="event-title"
              name="title"
              disabled={archived}
              required
              maxLength={200}
              defaultValue={event?.title}
              className="h-11"
            />
          </FormField>
          <div className="grid gap-1.5">
            <Label htmlFor="event-description">
              Description
              <span className="font-normal text-muted-foreground">
                Required before publication
              </span>
            </Label>
            <div className="relative">
              <AlignLeft
                aria-hidden="true"
                className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
              />
              <Textarea
                id="event-description"
                name="description"
                disabled={archived}
                defaultValue={event?.description ?? ""}
                className="min-h-32 pl-9"
              />
            </div>
          </div>
        </EventFormSection>

        <EventFormSection
          icon={CalendarClock}
          title="Schedule & venue"
          description="Choose the time and place attendees should use."
        >
          <div className="grid gap-1.5">
            <Label htmlFor="event-date">
              Date and time
              <span className="font-normal text-muted-foreground">
                Asia/Muscat (UTC+04:00)
              </span>
            </Label>
            <Input
              id="event-date"
              name="eventDate"
              type="datetime-local"
              disabled={archived}
              readOnly={
                past ||
                Boolean(
                  event && event.confirmedCount + event.waitlistedCount > 0
                )
              }
              required
              defaultValue={event ? muscatDateTimeValue(event.eventDate) : ""}
              className="h-11 w-full sm:w-72"
            />
            {eventStatus === "archived" ? (
              <p className="text-xs leading-5 text-warning-soft-foreground">
                Archived events are read-only. Restore the event from the
                lifecycle panel before editing its details.
              </p>
            ) : eventStatus === "published" || eventStatus === "full" ? (
              <p className="text-xs leading-5 text-muted-foreground">
                While registrations exist, the event date cannot be moved.
                Capacity cannot be reduced below confirmed registrations.
              </p>
            ) : eventStatus === "past" ? (
              <p className="text-xs leading-5 text-warning-soft-foreground">
                This event has started. Its date and capacity are locked; update
                descriptive details only when the lifecycle rules allow it.
              </p>
            ) : null}
          </div>
          <FormField htmlFor="event-location" label="Location">
            <Input
              id="event-location"
              name="location"
              disabled={archived}
              defaultValue={event?.location ?? ""}
              className="h-11"
              placeholder="e.g. Block 6, Lecture Hall 3"
            />
          </FormField>
        </EventFormSection>

        <EventFormSection
          icon={Ticket}
          title="Registration settings"
          description="Decide whether this event has a capacity limit."
        >
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Limit capacity</p>
              <p className="text-xs text-muted-foreground">
                Confirmed registrations alone consume seats.
              </p>
            </div>
            <Switch
              checked={hasCapacityLimit}
              onCheckedChange={setHasCapacityLimit}
              aria-label="Limit capacity"
              disabled={archived || past}
            />
          </div>
          {hasCapacityLimit ? (
            <div className="grid gap-1.5 pt-1">
              <Label htmlFor="event-capacity">
                <Users
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
                Capacity
              </Label>
              <Input
                id="event-capacity"
                name="capacity"
                type="number"
                disabled={archived}
                readOnly={past}
                min="1"
                required
                defaultValue={event?.capacity ?? ""}
                className="h-11 w-full sm:w-40"
              />
            </div>
          ) : null}
        </EventFormSection>
      </div>

      <aside className="xl:order-2">
        <div className="grid gap-3 xl:sticky xl:top-6">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-panel">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {event ? "Current event" : "New event"}
            </p>
            <div className="mt-3">
              {eventStatus ? (
                <EventStatusBadge status={eventStatus} />
              ) : (
                <EventStatusBadge status="draft" />
              )}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {event
                ? "Save the details below before changing publication or review state."
                : "New events begin as private committee drafts."}
            </p>
            {event ? (
              <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Revision</dt>
                  <dd className="font-medium tabular-nums">{event.revision}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Capacity</dt>
                  <dd className="font-medium tabular-nums">
                    {event.capacity ?? "Unlimited"}
                  </dd>
                </div>
              </dl>
            ) : null}
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  {event
                    ? "Lifecycle actions use the current saved revision."
                    : "You can request second-manager review after creating the draft."}
                </p>
              </div>
            </div>
            {event?.reviewRequired && event.approvedBy ? (
              <Alert className="mt-4 border-warning/30 bg-warning-soft/30">
                <AlertTitle>Approval will be cleared</AlertTitle>
                <AlertDescription>
                  Changing event details creates a new revision. Another active
                  committee manager must approve it before a later publish or
                  reopen action. Published changes appear publicly immediately.
                  Saving unchanged details keeps the approval.
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              disabled={pending || archived}
              className="mt-5 h-11 w-full"
            >
              {pending ? <Spinner /> : <Save aria-hidden="true" />}
              {pending
                ? "Saving…"
                : archived
                  ? "Restore to edit"
                  : event
                    ? "Save changes"
                    : "Create draft"}
            </Button>
          </div>
          <p aria-live="polite" className="sr-only">
            {pending ? "Saving event" : ""}
          </p>
        </div>
      </aside>
    </form>
  );
}
