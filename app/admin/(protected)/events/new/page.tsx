import { getManagerContext } from "@/lib/auth/manager";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EventForm } from "../event-form";

export default async function NewEventPage() {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  return (
    <section aria-labelledby="new-event-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="new-event-title"
        title="Create an event"
        description="Start with a private draft, then review its details before publication."
      />
      <EventForm
        committees={manager.committees.filter(
          (committee) => !committee.archived
        )}
      />
    </section>
  );
}
