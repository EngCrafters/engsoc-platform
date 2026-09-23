import { Infinity as InfinityIcon, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shows the configured capacity limit only. The admin event list does not
 * join registrations (see CLAUDE.md guardrails: no new database calls for
 * this milestone), so this never claims a live confirmed-registration count
 * — that would be fabricating a number the query doesn't have.
 */
export function CapacityIndicator({
  capacity,
  full,
  className,
}: {
  capacity: number | null;
  full: boolean;
  className?: string;
}) {
  if (capacity === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
          className
        )}
      >
        <InfinityIcon aria-hidden="true" className="size-3.5" />
        Unlimited capacity
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        full ? "font-medium text-full" : "text-muted-foreground",
        className
      )}
    >
      <Users aria-hidden="true" className="size-3.5" />
      {capacity} {capacity === 1 ? "place" : "places"}
    </span>
  );
}
