import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "mt-8 flex max-w-xl flex-col items-start gap-4 rounded-xl border border-dashed border-border bg-surface px-6 py-10",
        className
      )}
      aria-labelledby="empty-state-title"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <h2
          id="empty-state-title"
          className="text-lg font-semibold tracking-tight"
        >
          {title}
        </h2>
        <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </section>
  );
}
