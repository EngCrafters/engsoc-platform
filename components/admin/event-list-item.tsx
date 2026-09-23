import Link from "next/link";
import { motion } from "motion/react";
import {
  Building2,
  CalendarDays,
  ChevronRight,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import { CapacityIndicator } from "@/components/admin/capacity-indicator";
import { RegistrationCounts } from "@/components/admin/registration-counts";
import { formatEventDate } from "@/lib/events/format";
import { getEventLifecycleStatus } from "@/lib/admin-events/status";
import type { AdminEvent } from "@/lib/admin-events/server";
import { listItem } from "@/lib/motion/variants";

export function EventListItem({ event }: { event: AdminEvent }) {
  const status = getEventLifecycleStatus(event);
  const full = status === "full";

  return (
    <motion.li variants={listItem} className="group">
      <Link
        href={`/admin/events/${event.id}`}
        className="grid grid-cols-1 gap-3 px-4 py-4 transition-colors duration-150 hover:bg-muted/60 focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_8.5rem_minmax(0,1fr)_11rem_5rem] lg:items-center lg:gap-5 lg:py-4"
      >
        <div className="min-w-0">
          <h3 className="truncate text-[0.95rem] font-semibold tracking-tight text-foreground group-hover:text-primary">
            {event.title}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{event.committeeName}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 lg:block">
          <EventStatusBadge status={status} />
          {status === "approved" ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-warning-soft-foreground lg:mt-1.5"
              title="Reviewed under the second-manager approval requirement"
            >
              <ShieldAlert aria-hidden="true" className="size-3" />
              <span className="lg:hidden">Reviewed</span>
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-foreground/90">
            <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
            {formatEventDate(new Date(event.eventDate))}
          </p>
          {event.location ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{event.location}</span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <CapacityIndicator capacity={event.capacity} full={full} />
          <RegistrationCounts
            confirmedCount={event.confirmedCount}
            waitlistedCount={event.waitlistedCount}
            className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs lg:grid lg:gap-0.5"
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-sm font-medium text-primary lg:justify-self-end lg:border-0 lg:pt-0">
          <span className="lg:hidden">Manage event</span>
          <span className="hidden lg:inline">Manage</span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </div>
      </Link>
    </motion.li>
  );
}
