import Link from "next/link";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEventDate } from "@/lib/events/format";
import { getEventLifecycleStatus } from "@/lib/admin-events/status";
import type { AdminEvent } from "@/lib/admin-events/server";

const cell = "group-data-[density=compact]/admin:py-1.5";

function EventRow({ event }: { event: AdminEvent }) {
  const status = getEventLifecycleStatus(event);
  const date = formatEventDate(new Date(event.eventDate));
  const capacity = event.capacity === null ? "Unlimited" : event.capacity;

  return (
    <TableRow>
      <TableCell
        className={`${cell} w-full max-w-0 whitespace-normal md:w-auto md:max-w-none md:min-w-52`}
      >
        <Link
          href={`/admin/events/${event.id}`}
          className="block truncate font-medium hover:underline focus-visible:underline"
        >
          {event.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {event.committeeName}
          <span className="md:hidden"> · {date}</span>
        </p>
      </TableCell>
      <TableCell className={`${cell} hidden whitespace-normal md:table-cell`}>
        <p>{date}</p>
        {event.location ? (
          <p className="max-w-56 truncate text-xs text-muted-foreground">
            {event.location}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={cell}>
        <div className="flex flex-col items-start gap-1">
          <EventStatusBadge status={status} />
          {status === "approved" ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="Reviewed under the second-manager approval requirement"
            >
              <ShieldAlert aria-hidden="true" className="size-3" />
              Reviewed
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className={`${cell} hidden lg:table-cell`}>
        <p
          aria-label={`${event.confirmedCount} confirmed, ${event.waitlistedCount} waitlisted`}
          className="tabular-nums"
        >
          {event.confirmedCount} confirmed
          <span className="text-muted-foreground">
            {" "}
            · {event.waitlistedCount} waitlisted
          </span>
        </p>
      </TableCell>
      <TableCell
        className={`${cell} hidden text-muted-foreground tabular-nums xl:table-cell`}
      >
        {capacity}
      </TableCell>
      <TableCell className={`${cell} text-right`}>
        <Button asChild variant="ghost" size="sm">
          <Link
            href={`/admin/events/${event.id}`}
            aria-label={`Manage ${event.title}`}
          >
            <span className="hidden sm:inline">Manage</span>
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function EventList({ events }: { events: AdminEvent[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">
              Registrations
            </TableHead>
            <TableHead className="hidden xl:table-cell">Capacity</TableHead>
            <TableHead className="w-px">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
