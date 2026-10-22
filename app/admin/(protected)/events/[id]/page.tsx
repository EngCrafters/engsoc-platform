import { notFound } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { getAdminEvent } from "@/lib/admin-events/server";
import { getEventLifecycleStatus } from "@/lib/admin-events/status";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EventDetailTabs } from "@/components/admin/event-detail-tabs";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import { Button } from "@/components/ui/button";
import { EventForm } from "../event-form";
import { LifecycleActions } from "../lifecycle-actions";
import { PermanentDeletionDialog } from "@/components/admin/permanent-deletion-dialog";

export default async function EventPage({
  params,
}: PageProps<"/admin/events/[id]">) {
  const [{ id }, manager] = await Promise.all([params, getManagerContext()]);
  if (manager.kind !== "manager") return null;
  const event = await getAdminEvent(manager.userId, id);
  if (!event) notFound();
  const status = getEventLifecycleStatus(event);
  return (
    <section aria-labelledby="edit-event-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="edit-event-title"
        title={event.title}
        description={`Edit details for this ${event.committeeName} event. Lifecycle controls use the saved revision.`}
        context={
          <>
            <EventStatusBadge status={status} />
            <span className="text-sm text-muted-foreground">
              {event.committeeName}
            </span>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/admin/events/${event.id}/attendance`}>
                Attendance &amp; QR
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/events/${event.id}/registrations`}>
                <Users aria-hidden="true" data-icon="inline-start" />
                Registrations
                <span className="text-muted-foreground tabular-nums">
                  {event.confirmedCount + event.waitlistedCount}
                </span>
              </Link>
            </Button>
          </div>
        }
      />
      <EventDetailTabs
        details={
          <EventForm
            event={event}
            eventStatus={status}
            committees={manager.committees}
          />
        }
        lifecycle={
          <div className="flex flex-col gap-6">
            <LifecycleActions
              eventId={event.id}
              revision={event.revision}
              status={event.status}
              archived={Boolean(event.archivedAt)}
              reviewRequired={event.reviewRequired}
              isFlagger={event.flaggedBy === manager.userId}
              canReview={manager.accessLevel !== "COMMITTEE_MANAGER"}
              isApproved={event.approvedBy !== null}
              isPast={status === "past"}
              lifecycleStatus={status}
            />
            {manager.accessLevel !== "COMMITTEE_MANAGER" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
                <div className="flex max-w-xl flex-col gap-1">
                  <p className="text-sm font-medium">Delete permanently</p>
                  <p className="text-sm text-muted-foreground">
                    Removes the event, its registrations with their personal
                    data, and its cover image for good. Only archived events or
                    never-published drafts can be deleted; archiving stays the
                    reversible option.
                  </p>
                </div>
                <PermanentDeletionDialog kind="event" id={event.id} />
              </div>
            ) : null}
          </div>
        }
      />
    </section>
  );
}
