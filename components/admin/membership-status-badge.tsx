import {
  BadgeCheck,
  CircleSlash,
  Hourglass,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/membership/labels";
import type { ApplicationStatus } from "@/lib/membership/types";
import { cn } from "@/lib/utils";

/** Monochrome like the event badges: told apart by icon, wording and fill. */
const STYLE: Record<
  ApplicationStatus,
  {
    icon: LucideIcon;
    variant: "default" | "secondary" | "outline";
    className?: string;
  }
> = {
  pending_review: {
    icon: Hourglass,
    variant: "outline",
    className: "border-dashed",
  },
  verified: { icon: ScanSearch, variant: "secondary" },
  approved: { icon: BadgeCheck, variant: "default" },
  rejected: {
    icon: CircleSlash,
    variant: "outline",
    className: "text-muted-foreground",
  },
};

export function MembershipStatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  const style = STYLE[status];
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {STATUS_LABELS[status]}
    </Badge>
  );
}
