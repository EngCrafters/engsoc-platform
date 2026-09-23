import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Users } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { getAdminEvent } from "@/lib/admin-events/server";
import {
  countAdminRegistrations,
  listAdminRegistrations,
} from "@/lib/admin-registrations/server";
import {
  decodeRegistrationCursor,
  encodeRegistrationCursor,
} from "@/lib/admin-registrations/cursor";
import { parseRegistrationStatus } from "@/lib/admin-registrations/types";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { PromoteButton } from "./promote-button";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? undefined : value;
}

export default async function RegistrationsPage({
  params,
  searchParams,
}: PageProps<"/admin/events/[id]/registrations">) {
  const [{ id }, query, manager] = await Promise.all([
    params,
    searchParams,
    getManagerContext(),
  ]);
  if (manager.kind !== "manager") return null;
  const event = await getAdminEvent(manager.userId, id);
  if (!event) notFound();
  const status = parseRegistrationStatus(single(query.status));
  const cursorResult = decodeRegistrationCursor(
    single(query.cursor),
    id,
    status
  );
  const [counts, result] = await Promise.all([
    countAdminRegistrations(manager.userId, id),
    cursorResult.invalid
      ? Promise.resolve({ registrations: [], nextCursor: null })
      : listAdminRegistrations(manager.userId, id, status, cursorResult.cursor),
  ]);
  if (!counts) notFound();
  const nextHref = result.nextCursor
    ? `/admin/events/${id}/registrations?status=${status}&cursor=${encodeRegistrationCursor(result.nextCursor, id, status)}`
    : null;
  return (
    <section aria-labelledby="registrations-title">
      <Link
        href={`/admin/events/${id}`}
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to event
      </Link>
      <AdminPageHeader
        eyebrow={event.committeeName}
        title={`${event.title} registrations`}
        headingId="registrations-title"
        description="Review private registrations for this event. Waitlist promotion is FIFO and requires contact confirmation."
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted-foreground">Confirmed</p>
          <p className="mt-1 text-3xl font-semibold">
            {counts.confirmed_count}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted-foreground">Waitlisted</p>
          <p className="mt-1 text-3xl font-semibold">
            {counts.waitlisted_count}
          </p>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <nav aria-label="Registration status" className="flex gap-2">
          <Link
            className={`rounded-md px-3 py-2 text-sm ${status === "confirmed" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            href={`/admin/events/${id}/registrations?status=confirmed`}
          >
            Confirmed
          </Link>
          <Link
            className={`rounded-md px-3 py-2 text-sm ${status === "waitlisted" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            href={`/admin/events/${id}/registrations?status=waitlisted`}
          >
            Waitlisted
          </Link>
        </nav>
        <form
          method="post"
          action={`/admin/events/${id}/registrations/export?status=${status}`}
        >
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-primary/40 hover:bg-primary-soft/30"
          >
            <Download className="size-4" /> Export {status}
          </button>
        </form>
      </div>
      {cursorResult.invalid ? (
        <p className="mt-5 rounded-lg border border-danger/30 bg-danger-soft/30 p-4 text-sm text-danger">
          This registration page link is invalid. Return to the first page.
        </p>
      ) : null}
      {result.registrations.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={Users}
            title="No registrations yet"
            description={
              status === "waitlisted"
                ? "There are no waitlisted registrations for this event."
                : "There are no confirmed registrations for this event."
            }
          />
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="divide-y divide-border">
            {result.registrations.map((registration) => (
              <div
                key={registration.id}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {registration.attendeeName}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {registration.attendeeEmail}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Registered{" "}
                    {new Date(registration.registeredAt).toLocaleString(
                      "en-GB",
                      { dateStyle: "medium", timeStyle: "short" }
                    )}
                  </p>
                </div>
                {status === "waitlisted" ? (
                  <PromoteButton
                    eventId={id}
                    registrationId={registration.id}
                  />
                ) : (
                  <span className="w-fit rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success-soft-foreground">
                    Confirmed
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-6 flex justify-end">
        {nextHref ? (
          <Link
            href={nextHref}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Next page
          </Link>
        ) : null}
      </div>
    </section>
  );
}
