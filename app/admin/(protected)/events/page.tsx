import Link from "next/link";
import { CalendarPlus, CalendarRange } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { countAdminEvents, listAdminEvents } from "@/lib/admin-events/server";
import {
  decodeAdminEventCursor,
  encodeAdminEventCursor,
} from "@/lib/admin-events/cursor";
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
  const [counts, { events, nextCursor }] = await Promise.all([
    countAdminEvents(manager.userId, committeeId),
    cursorResult.invalid
      ? Promise.resolve({ events: [], nextCursor: null })
      : listAdminEvents(manager.userId, {
          committeeId,
          filter,
          cursor: cursorResult.cursor,
        }),
  ]);

  return (
    <section
      aria-labelledby="admin-events-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        title="Events"
        headingId="admin-events-title"
        description="Plan, publish, and manage your committee events."
        actions={
          <Button asChild>
            <Link href="/admin/events/new">
              <CalendarPlus aria-hidden="true" data-icon="inline-start" />
              Create event
            </Link>
          </Button>
        }
      />
      {counts.total > 0 ? <EventSummaryStats counts={counts} /> : null}
      <EventListFilters
        committees={manager.committees}
        committeeId={committeeId}
        filter={filter}
      >
        {cursorResult.invalid ? (
          <Alert variant="destructive">
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
                  <CalendarPlus aria-hidden="true" data-icon="inline-start" />
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
      </EventListFilters>
    </section>
  );
}
