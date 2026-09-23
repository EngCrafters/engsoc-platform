import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  eyebrow,
  title,
  headingId,
  description,
  actions,
  context,
  className,
}: {
  eyebrow?: string;
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
        "flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1
          id={headingId}
          className={cn(
            "break-words text-[1.9rem] font-semibold tracking-[-0.045em] text-foreground sm:text-[2.25rem]",
            eyebrow ? "mt-1" : ""
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {context ? <div className="mt-3">{context}</div> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
