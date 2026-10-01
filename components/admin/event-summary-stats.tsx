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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const primaryStats = [
  {
    key: "total",
    label: "Total records",
    icon: CalendarRange,
    tone: "text-muted-foreground",
  },
  {
    key: "draft",
    label: "Draft",
    icon: PenLine,
    tone: "text-quiet-soft-foreground",
  },
  {
    key: "review",
    label: "Needs review",
    icon: ShieldAlert,
    tone: "text-warning-soft-foreground",
  },
  {
    key: "published",
    label: "Published",
    icon: Globe2,
    tone: "text-success-soft-foreground",
  },
] as const;

const secondaryStats = [
  { key: "approved", label: "Approved draft", icon: ShieldCheck },
  { key: "full", label: "Full", icon: Ban },
  { key: "past", label: "Past", icon: Clock3 },
  { key: "archived", label: "Archived", icon: Archive },
] as const;

export function EventSummaryStats({ counts }: { counts: AdminEventCounts }) {
  return (
    <div className="grid gap-3 sm:gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {primaryStats.map(({ key, label, icon: Icon, tone }) => (
          <Card key={key} className="min-w-0 gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon
                  aria-hidden="true"
                  className={cn("size-4 shrink-0", tone)}
                  strokeWidth={1.8}
                />
                <span className="truncate">{label}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                {counts[key]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-4 sm:px-5">
        {secondaryStats.map(({ key, label, icon: Icon }) => (
          <div key={key} className="flex min-w-0 items-center gap-2">
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                key === "approved" && "text-success-soft-foreground",
                key === "full" && "text-full-soft-foreground",
                (key === "past" || key === "archived") &&
                  "text-muted-foreground"
              )}
              strokeWidth={1.8}
            />
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {label}
            </span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">
              {counts[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
