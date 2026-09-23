import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <section aria-label="Loading events" className="motion-reduce:animate-none">
      <div className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-11 w-36 rounded-lg" />
      </div>
      <div className="mt-6 grid gap-2.5">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[4.75rem] rounded-xl md:h-16" />
        ))}
      </div>
    </section>
  );
}
