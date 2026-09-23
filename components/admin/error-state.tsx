import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      role="alert"
      className={cn(
        "flex max-w-xl flex-col items-start gap-4 rounded-xl border border-danger/25 bg-danger-soft px-6 py-8",
        className
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-surface text-danger">
        <AlertTriangle aria-hidden="true" className="size-5" />
      </span>
      <div>
        <h1 className="text-lg font-semibold text-danger-soft-foreground">
          {title}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-danger-soft-foreground/90">
          {description}
        </p>
      </div>
      {action}
    </section>
  );
}
