import { getManagerContext } from "@/lib/auth/manager";
import { canAny, committeesFor } from "@/lib/auth/permissions";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EventForm } from "../event-form";

export default async function NewEventPage() {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  if (!canAny(manager, "events.create"))
    return (
      <p role="alert">Creating events needs the Create events permission.</p>
    );
  return (
    <section aria-labelledby="new-event-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="new-event-title"
        title="Create an event"
        description="Start with a private draft, then review its details before publication."
      />
      <EventForm
        committees={committeesFor(
          manager,
          "events.create",
          manager.allCommittees
        ).filter((committee) => !committee.archived)}
      />
    </section>
  );
}
