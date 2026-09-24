import {
  Archive,
  Ban,
  CalendarRange,
  Clock3,
  Globe2,
  PenLine,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { AdminEventCounts } from "@/lib/admin-events/server";
import { cn } from "@/lib/utils";

const STATS = [
  {
    key: "total",
    label: "Total records",
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
    key: "approved",
    label: "Approved draft",
    icon: ShieldCheck,
    tone: "text-success-soft-foreground",
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
  {
    key: "past",
    label: "Past",
    icon: Clock3,
    tone: "text-muted-foreground",
  },
  {
    key: "archived",
    label: "Archived",
    icon: Archive,
    tone: "text-muted-foreground",
  },
] as const;

export function EventSummaryStats({ counts }: { counts: AdminEventCounts }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-panel sm:grid-cols-4">
      {STATS.map(({ key, label, icon: Icon, tone }) => (
        <div key={key} className="min-w-0 bg-surface px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon aria-hidden="true" className={cn("size-3.5", tone)} />
            <span className="truncate">{label}</span>
          </div>
          <p className="mt-3 text-[1.75rem] font-semibold tabular-nums tracking-tight text-foreground">
            {counts[key]}
          </p>
        </div>
      ))}
    </div>
  );
}
