"use client";

import { motion } from "motion/react";
import { EventListItem } from "@/components/admin/event-list-item";
import { listStagger } from "@/lib/motion/variants";
import type { AdminEvent } from "@/lib/admin-events/server";

export function EventList({ events }: { events: AdminEvent[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Event management
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open an event to edit details or manage its lifecycle.
          </p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {events.length} shown
        </span>
      </div>
      <div className="hidden border-b border-border bg-muted/50 px-6 py-3 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1.5fr)_8.5rem_minmax(0,1fr)_11rem_5rem] lg:gap-5">
        <span>Event</span>
        <span>State</span>
        <span>Schedule & venue</span>
        <span>Attendance</span>
        <span className="text-right">Action</span>
      </div>
      <motion.ul
        className="divide-y divide-border"
        initial="initial"
        animate="animate"
        variants={listStagger}
      >
        {events.map((event) => (
          <EventListItem key={event.id} event={event} />
        ))}
      </motion.ul>
    </div>
  );
}
