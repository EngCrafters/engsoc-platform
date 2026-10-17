import { Skeleton } from "@/components/ui/skeleton";

export default function MarketingLoading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14"
    >
      <p className="sr-only">Loading events…</p>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-9 w-72 max-w-full" />
      <Skeleton className="mt-3 h-5 w-96 max-w-full" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
