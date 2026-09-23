"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle, SlidersHorizontal } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AdminEventFilter,
  ADMIN_EVENT_FILTERS,
} from "@/lib/admin-events/types";

const FILTER_LABELS: Record<AdminEventFilter, string> = {
  all: "All non-archived events",
  draft: "Draft",
  published: "Published",
  full: "Full",
  past: "Past",
  archived: "Archived",
};

export function EventListFilters({
  committees,
  committeeId,
  filter,
}: {
  committees: readonly { id: string; name: string }[];
  committeeId: string | null;
  filter: AdminEventFilter;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: "committee" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    if (value === "all") params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname)
    );
  }

  return (
    <section
      aria-label="Filter events"
      className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-surface px-4 py-4 shadow-panel sm:px-5 lg:flex-row lg:items-end lg:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2.5 text-sm font-semibold text-foreground">
        {pending ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <SlidersHorizontal
            aria-hidden="true"
            className="mt-0.5 size-4 text-primary"
          />
        )}
        <span>
          <span className="block">
            {pending ? "Updating events" : "Filter events"}
          </span>
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            Narrow the list by committee and state
          </span>
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="event-committee-filter"
          >
            Committee
          </label>
          <Select
            value={committeeId ?? "all"}
            onValueChange={(value) => update("committee", value)}
          >
            <SelectTrigger
              id="event-committee-filter"
              aria-label="Filter by committee"
              className="h-10 w-full sm:w-52"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Committee</SelectLabel>
                <SelectItem value="all">All my committees</SelectItem>
                {committees.map((committee) => (
                  <SelectItem key={committee.id} value={committee.id}>
                    {committee.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="event-status-filter"
          >
            Status
          </label>
          <Select
            value={filter}
            onValueChange={(value) => update("status", value)}
          >
            <SelectTrigger
              id="event-status-filter"
              aria-label="Filter by event status"
              className="h-10 w-full sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Lifecycle</SelectLabel>
                {ADMIN_EVENT_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {FILTER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}
