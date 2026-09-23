import Link from "next/link";
import { CalendarPlus, CalendarRange } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { listAdminEvents } from "@/lib/admin-events/server";
import {
  decodeAdminEventCursor,
  encodeAdminEventCursor,
} from "@/lib/admin-events/cursor";
import { getEventLifecycleStatus } from "@/lib/admin-events/status";
import { isUuid, parseAdminEventFilter } from "@/lib/admin-events/types";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EventSummaryStats } from "@/components/admin/event-summary-stats";
import { EventList } from "@/components/admin/event-list";
import { EmptyState } from "@/components/admin/empty-state";
import { EventListFilters } from "@/components/admin/event-list-filters";
import { EventListPagination } from "@/components/admin/event-list-pagination";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

export default async function AdminEventsPage({
  searchParams,
}: PageProps<"/admin/events">) {
  const query = await searchParams;
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  const filter = parseAdminEventFilter(single(query.status));
  const requestedCommittee = single(query.committee);
  const committeeId =
    requestedCommittee && isUuid(requestedCommittee)
      ? requestedCommittee
      : null;
  const cursorResult = decodeAdminEventCursor(single(query.cursor), {
    committeeId,
    filter,
  });
  const { events, nextCursor } = cursorResult.invalid
    ? { events: [], nextCursor: null }
    : await listAdminEvents(manager.userId, {
        committeeId,
        filter,
        cursor: cursorResult.cursor,
      });

  const counts = { draft: 0, review: 0, published: 0, full: 0 };
  for (const event of events) {
    const status = getEventLifecycleStatus(event);
    if (status === "draft") counts.draft += 1;
    else if (status === "review") counts.review += 1;
    else if (status === "published") counts.published += 1;
    else if (status === "full") counts.full += 1;
  }

  return (
    <section aria-labelledby="admin-events-title">
      <AdminPageHeader
        eyebrow="Management / Events"
        title="Events"
        headingId="admin-events-title"
        description={`Plan, publish, and manage events for ${manager.committees.map((committee) => committee.name).join(", ")}.`}
        actions={
          <Button asChild>
            <Link href="/admin/events/new">
              <CalendarPlus aria-hidden="true" />
              Create event
            </Link>
          </Button>
        }
      />
      {events.length > 0 ? (
        <section aria-label="Status counts on this page" className="mt-8">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Workspace overview
            </h2>
            <p className="text-xs text-muted-foreground">
              Current page · up to 20 events
            </p>
          </div>
          <EventSummaryStats counts={counts} total={events.length} />
        </section>
      ) : null}
      <EventListFilters
        committees={manager.committees}
        committeeId={committeeId}
        filter={filter}
      />
      {cursorResult.invalid ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>This page link is invalid</AlertTitle>
          <AlertDescription>
            Return to the first page and try again.
          </AlertDescription>
        </Alert>
      ) : null}
      {events.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title={
            cursorResult.invalid
              ? "Open a valid event list"
              : filter === "all"
                ? "Start with a draft"
                : "No matching events"
          }
          description={
            cursorResult.invalid
              ? "This link cannot be used to load events. Use the first page to start a new filtered view."
              : filter === "all"
                ? "Drafts stay private to your committee until their lifecycle requirements are complete. Create one when you're ready to begin planning."
                : "Try another committee or lifecycle filter, or create a new draft when you are ready to plan one."
          }
          action={
            <Button asChild variant="outline">
              <Link href="/admin/events/new">
                <CalendarPlus aria-hidden="true" />
                Create event
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <EventList events={events} />
          <EventListPagination
            nextHref={
              nextCursor
                ? (() => {
                    const params = new URLSearchParams();
                    if (committeeId) params.set("committee", committeeId);
                    if (filter !== "all") params.set("status", filter);
                    params.set(
                      "cursor",
                      encodeAdminEventCursor(nextCursor, {
                        committeeId,
                        filter,
                      })
                    );
                    return `/admin/events?${params.toString()}`;
                  })()
                : null
            }
          />
        </>
      )}
    </section>
  );
}
