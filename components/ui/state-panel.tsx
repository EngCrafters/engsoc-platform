import type { ElementType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared icon-circle + heading + description + action shape behind
 * EmptyState, ErrorState, and similar panels. See
 * docs/DESIGN_SYSTEM.md "Feedback states".
 */
export function StatePanel({
  icon: Icon,
  title,
  titleId,
  titleAs: TitleTag = "h2",
  description,
  action,
  tone = "neutral",
  role,
  className,
}: {
  icon: LucideIcon;
  title: string;
  titleId?: string;
  titleAs?: ElementType;
  description: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  role?: "alert";
  className?: string;
}) {
  return (
    <section
      role={role}
      aria-labelledby={titleId}
      className={cn(
        "flex max-w-xl flex-col items-start gap-4 rounded-xl border px-6",
        tone === "danger"
          ? "border-danger/25 bg-danger-soft py-8"
          : "border-dashed border-border bg-surface py-10",
        className
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full",
          tone === "danger"
            ? "size-10 bg-surface text-danger"
            : "size-11 bg-primary-soft text-primary-soft-foreground"
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <TitleTag
          id={titleId}
          className={cn(
            "text-lg font-semibold tracking-tight",
            tone === "danger" && "text-danger-soft-foreground"
          )}
        >
          {title}
        </TitleTag>
        <p
          className={cn(
            "mt-1.5 max-w-md text-sm leading-6",
            tone === "danger"
              ? "text-danger-soft-foreground/90"
              : "text-muted-foreground"
          )}
        >
          {description}
        </p>
      </div>
      {action ? <div>{action}</div> : null}
    </section>
  );
}
