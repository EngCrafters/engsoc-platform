import { Ban, CalendarRange, Globe2, PenLine, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const STATS = [
  {
    key: "total",
    label: "Events shown",
    icon: CalendarRange,
    tone: "text-primary",
  },
  {
    key: "draft",
    label: "Draft",
    icon: PenLine,
    tone: "text-quiet-soft-foreground",
  },
  {
    key: "review",
    label: "Review required",
    icon: ShieldAlert,
    tone: "text-warning-soft-foreground",
  },
  {
    key: "published",
    label: "Published",
    icon: Globe2,
    tone: "text-success-soft-foreground",
  },
  {
    key: "full",
    label: "Full",
    icon: Ban,
    tone: "text-full-soft-foreground",
  },
] as const;

export function EventSummaryStats({
  counts,
  total,
}: {
  counts: Record<"draft" | "review" | "published" | "full", number>;
  total: number;
}) {
  const values = { ...counts, total };
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-panel sm:grid-cols-3 xl:grid-cols-5">
      {STATS.map(({ key, label, icon: Icon, tone }) => (
        <div
          key={key}
          className="min-w-0 bg-surface px-4 py-4 last:col-span-2 sm:px-5 sm:py-5 sm:last:col-span-1"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon aria-hidden="true" className={cn("size-3.5", tone)} />
            <span className="truncate">{label}</span>
          </div>
          <p className="mt-3 text-[1.75rem] font-semibold tabular-nums tracking-tight text-foreground">
            {values[key]}
          </p>
        </div>
      ))}
    </div>
  );
}
