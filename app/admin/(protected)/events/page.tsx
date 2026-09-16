import { getManagerContext } from "@/lib/auth/manager";

export default async function AdminEventsPage() {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;

  return (
    <section aria-labelledby="admin-events-title">
      <p className="text-sm font-medium text-neutral-600">Committee scope</p>
      <h1
        id="admin-events-title"
        className="mt-1 text-3xl font-semibold tracking-tight"
      >
        Events
      </h1>
      <p className="mt-3 max-w-2xl text-neutral-700">
        Access is verified for{" "}
        {manager.committees.map((committee) => committee.name).join(", ")}.
        Event management is introduced in the next UC-02 milestone.
      </p>
    </section>
  );
}
