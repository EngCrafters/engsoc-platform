import { notFound } from "next/navigation";
import { getManagerContext } from "@/lib/auth/manager";
import { getAdminEvent } from "@/lib/admin-events/server";
import { getEventLifecycleStatus } from "@/lib/admin-events/status";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
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
    <section aria-labelledby="edit-event-title">
      <AdminPageHeader
        eyebrow={event.committeeName}
        headingId="edit-event-title"
        title={event.title}
        description={`Edit details for this ${event.committeeName} event. Lifecycle controls use the saved revision.`}
        context={<EventStatusBadge status={status} />}
      />
      <EventForm
        event={event}
        eventStatus={status}
        committees={manager.committees}
      />
      <LifecycleActions
        eventId={event.id}
        revision={event.revision}
        status={event.status}
        archived={Boolean(event.archivedAt)}
        reviewRequired={event.reviewRequired}
        isFlagger={event.flaggedBy === manager.userId}
        isApproved={event.approvedBy !== null}
        isPast={status === "past"}
        lifecycleStatus={status}
      />
    </section>
  );
}
