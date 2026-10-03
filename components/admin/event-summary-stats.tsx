import type { AdminEventCounts } from "@/lib/admin-events/server";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const metrics = [
  { key: "total", label: "Total events", hint: "In the selected scope" },
  { key: "published", label: "Published", hint: "Open to the public" },
  { key: "review", label: "Needs review", hint: "Awaiting a second manager" },
  { key: "draft", label: "Drafts", hint: "Private to the committee" },
] as const;

const breakdown = [
  { key: "approved", label: "Approved drafts" },
  { key: "full", label: "Full" },
  { key: "past", label: "Past" },
  { key: "archived", label: "Archived" },
] as const;

export function EventSummaryStats({ counts }: { counts: AdminEventCounts }) {
  return (
    <section
      aria-label="Event counts in selected committee scope"
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-4 @3xl/main:grid-cols-4">
        {metrics.map(({ key, label, hint }) => (
          <Card key={key} size="sm" className="min-w-0">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">
                {counts[key]}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </CardHeader>
          </Card>
        ))}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {breakdown.map(({ key, label }) => (
          <div key={key} className="flex gap-1.5">
            <dt>{label}</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {counts[key]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
