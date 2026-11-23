import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Params = Record<string, string | null | undefined>;

export function queueHref(basePath: string, params: Params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Status links and a GET filter form for a review queue (ADR 0025). Everything
 * lives in the URL, so the list stays server-rendered, shareable and usable
 * without JavaScript; changing a filter starts again at the first page.
 */
export function ReviewQueueControls({
  basePath,
  label,
  statuses,
  params,
  children,
}: {
  basePath: string;
  label: string;
  statuses: { value: string; label: string }[];
  params: Params & { status: string };
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label={`${label} status`}
        className="-mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0"
      >
        <ul className="inline-flex h-8 w-fit items-center gap-0.5 rounded-lg bg-muted p-[3px]">
          {statuses.map((status) => {
            const active = status.value === params.status;
            return (
              <li key={status.value} className="h-full">
                <Link
                  href={queueHref(basePath, {
                    ...params,
                    status: status.value === "pending" ? null : status.value,
                    offset: null,
                  })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-full items-center rounded-md border border-transparent px-2 text-sm font-medium whitespace-nowrap text-foreground/60 outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active &&
                      "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                  )}
                >
                  {status.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <form
        method="get"
        action={basePath}
        role="search"
        aria-label={`Filter ${label.toLowerCase()}`}
        className="flex flex-wrap items-end gap-3"
      >
        {params.status !== "pending" ? (
          <input type="hidden" name="status" value={params.status} />
        ) : null}
        <div className="grid min-w-48 flex-1 gap-1.5 sm:max-w-64">
          <Label htmlFor={`${basePath}-q`}>Search</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={`${basePath}-q`}
              type="search"
              name="q"
              defaultValue={params.q ?? ""}
              maxLength={100}
              placeholder="Name or email"
              className="pl-8"
            />
          </div>
        </div>
        {children}
        <div className="grid gap-1.5">
          <Label htmlFor={`${basePath}-from`}>Submitted from</Label>
          <Input
            id={`${basePath}-from`}
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className="w-40"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${basePath}-to`}>to</Label>
          <Input
            id={`${basePath}-to`}
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className="w-40"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          <Button asChild variant="ghost">
            <Link href={basePath}>Clear</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ReviewQueuePagination({
  basePath,
  params,
  offset,
  total,
  pageSize,
  label,
}: {
  basePath: string;
  params: Params;
  offset: number;
  total: number;
  pageSize: number;
  label: string;
}) {
  if (total <= pageSize && offset === 0) return null;
  const first = Math.min(offset + 1, total);
  const last = Math.min(offset + pageSize, total);
  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        {offset > 0 ? (
          <Button asChild variant="outline">
            <Link
              href={queueHref(basePath, {
                ...params,
                offset:
                  offset - pageSize > 0 ? String(offset - pageSize) : null,
              })}
            >
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Previous
            </Link>
          </Button>
        ) : null}
        {offset + pageSize < total ? (
          <Button asChild variant="outline">
            <Link
              href={queueHref(basePath, {
                ...params,
                offset: String(offset + pageSize),
              })}
            >
              Next
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
