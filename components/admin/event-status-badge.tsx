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
import { Badge, type badgeVariants } from "@/components/ui/badge";
import {
  EVENT_STATUS_META,
  type EventLifecycleStatus,
} from "@/lib/admin-events/status";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const STATUS_STYLE: Record<
  EventLifecycleStatus,
  { icon: LucideIcon; variant: BadgeVariant }
> = {
  draft: { icon: PenLine, variant: "quiet" },
  review: { icon: ShieldAlert, variant: "warning" },
  approved: { icon: ShieldCheck, variant: "primary-soft" },
  published: { icon: Globe2, variant: "success" },
  full: { icon: Ban, variant: "full" },
  past: { icon: History, variant: "quiet" },
  archived: { icon: Archive, variant: "quiet" },
};

/**
 * Status is never carried by color alone: every badge pairs an icon with
 * text. See CLAUDE.md "Status components".
 */
export function EventStatusBadge({
  status,
  className,
}: {
  status: EventLifecycleStatus;
  className?: string;
}) {
  const { icon: Icon, variant } = STATUS_STYLE[status];
  const { label } = EVENT_STATUS_META[status];
  return (
    <Badge variant={variant} className={cn("gap-1 py-1", className)}>
      <Icon aria-hidden="true" data-icon="inline-start" className="size-3" />
      {label}
    </Badge>
  );
}
