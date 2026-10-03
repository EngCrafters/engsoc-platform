import {
  Archive,
  Ban,
  Globe2,
  History,
  PenLine,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  EVENT_STATUS_META,
  type EventLifecycleStatus,
} from "@/lib/admin-events/status";
import { cn } from "@/lib/utils";

/**
 * Statuses stay monochrome. Each is told apart by icon, wording, fill,
 * border style and weight, never by hue alone.
 */
const STATUS_STYLE: Record<
  EventLifecycleStatus,
  {
    icon: LucideIcon;
    variant: "default" | "secondary" | "outline";
    className?: string;
  }
> = {
  draft: { icon: PenLine, variant: "outline" },
  review: { icon: ShieldAlert, variant: "outline", className: "border-dashed" },
  approved: { icon: ShieldCheck, variant: "secondary" },
  published: { icon: Globe2, variant: "default" },
  full: { icon: Ban, variant: "secondary", className: "font-semibold" },
  past: {
    icon: History,
    variant: "outline",
    className: "text-muted-foreground",
  },
  archived: {
    icon: Archive,
    variant: "outline",
    className: "border-dashed text-muted-foreground",
  },
};

export function EventStatusBadge({
  status,
  className,
}: {
  status: EventLifecycleStatus;
  className?: string;
}) {
  const { icon: Icon, variant, className: style } = STATUS_STYLE[status];
  const { label } = EVENT_STATUS_META[status];
  return (
    <Badge variant={variant} className={cn(style, className)}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Badge>
  );
}
