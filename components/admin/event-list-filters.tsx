"use client";

import { useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type AdminEventFilter,
  ADMIN_EVENT_FILTERS,
} from "@/lib/admin-events/types";

const FILTER_LABELS: Record<AdminEventFilter, string> = {
  all: "All",
  draft: "Draft",
  published: "Published",
  full: "Full",
  past: "Past",
  archived: "Archived",
};

/**
 * Lifecycle tabs plus the committee scope select, with the filtered list as
 * the tab content. Filters live in the URL so the list stays server-rendered
 * and shareable; "All" means every non-archived event.
 */
export function EventListFilters({
  committees,
  globalScope,
  committeeId,
  filter,
  children,
}: {
  committees: readonly { id: string; name: string }[];
  globalScope: boolean;
  committeeId: string | null;
  filter: AdminEventFilter;
  children: ReactNode;
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
    <Tabs
      value={filter}
      onValueChange={(value) => update("status", value)}
      className="gap-4"
    >
      <div
        role="search"
        aria-label="Filter events"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Event status">
            {ADMIN_EVENT_FILTERS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {FILTER_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="flex items-center gap-2">
          {pending ? (
            <span role="status" className="flex items-center gap-1.5">
              <Spinner />
              <span className="sr-only">Updating events</span>
            </span>
          ) : null}
          {committees.length > 1 ? (
            <Select
              value={committeeId ?? "all"}
              onValueChange={(value) => update("committee", value)}
            >
              <SelectTrigger
                id="event-committee-filter"
                aria-label="Filter by committee"
                className="w-full sm:w-52"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">
                    {globalScope ? "All Committees" : "My Committee"}
                  </SelectItem>
                  {committees.map((committee) => (
                    <SelectItem key={committee.id} value={committee.id}>
                      {committee.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>
      <TabsContent value={filter} className="flex flex-col gap-4">
        {children}
      </TabsContent>
    </Tabs>
  );
}
