"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MembershipFilter } from "@/lib/membership/server";

const FILTERS: { value: MembershipFilter; label: string }[] = [
  { value: "pending_review", label: "Pending review" },
  { value: "verified", label: "Verified" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

/**
 * Status tabs and a name/email/student-ID search, kept in the URL like the
 * event filters so the list stays server-rendered and shareable.
 */
export function MembershipFilters({
  filter,
  query,
  counts,
  children,
}: {
  filter: MembershipFilter;
  query: string | null;
  counts: Partial<Record<MembershipFilter, number>>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query ?? "");

  function navigate(next: { status?: MembershipFilter; q?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    if (next.status !== undefined) {
      if (next.status === "pending_review") params.delete("status");
      else params.set("status", next.status);
    }
    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim().slice(0, 100));
      else params.delete("q");
    }
    const value = params.toString();
    startTransition(() =>
      router.replace(value ? `${pathname}?${value}` : pathname)
    );
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    navigate({ q: text });
  }

  return (
    <Tabs
      value={filter}
      onValueChange={(value) => navigate({ status: value as MembershipFilter })}
      className="gap-4"
    >
      <div
        role="search"
        aria-label="Filter membership applications"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Application status">
            {FILTERS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
                {typeof counts[item.value] === "number" ? (
                  <span className="text-muted-foreground tabular-nums">
                    {counts[item.value]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <form onSubmit={onSearch} className="flex items-center gap-2">
          {pending ? (
            <span role="status" className="flex items-center gap-1.5">
              <Spinner />
              <span className="sr-only">Updating applications</span>
            </span>
          ) : null}
          <div className="relative w-full sm:w-64">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Name, email or student ID"
              aria-label="Search applications"
              maxLength={100}
              className="pl-8"
            />
          </div>
        </form>
      </div>
      <TabsContent value={filter} className="flex flex-col gap-4">
        {children}
      </TabsContent>
    </Tabs>
  );
}
