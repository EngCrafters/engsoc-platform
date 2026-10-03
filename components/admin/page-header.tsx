import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page header: title, one-line description, optional context
 * (status, committee) and the page's primary action on the right.
 */
export function AdminPageHeader({
  title,
  headingId,
  description,
  actions,
  context,
  className,
}: {
  title: string;
  headingId?: string;
  description?: string;
  actions?: ReactNode;
  context?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1
          id={headingId}
          className="text-3xl font-semibold tracking-tight break-words"
        >
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {context ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {context}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
