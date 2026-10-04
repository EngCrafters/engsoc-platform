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
          <Button asChild variant="outline">
            <Link href={`/admin/events/${event.id}/registrations`}>
              <Users aria-hidden="true" data-icon="inline-start" />
              Registrations
              <span className="text-muted-foreground tabular-nums">
                {event.confirmedCount + event.waitlistedCount}
              </span>
            </Link>
          </Button>
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
        }
      />
    </section>
  );
}
