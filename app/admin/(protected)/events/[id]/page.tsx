import { notFound } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
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
      <div className="mt-8">
        <Link
          href={`/admin/events/${event.id}/registrations`}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-primary/40 hover:bg-primary-soft/30"
        >
          <Users aria-hidden="true" className="size-4" />
          Manage registrations
        </Link>
      </div>
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
