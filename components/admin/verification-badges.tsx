import {
  BadgeCheck,
  CircleSlash,
  Hourglass,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  LEADERSHIP_STATUS_LABELS,
  SQU_STATE_LABELS,
  TEAM_STATUS_LABELS,
} from "@/lib/verification/labels";
import type {
  LeadershipStatus,
  SquListState,
  TeamSummary,
} from "@/lib/verification/types";
import { cn } from "@/lib/utils";

type Style = {
  icon: LucideIcon;
  variant: "default" | "secondary" | "outline";
  className?: string;
};

/** Monochrome like the membership badges: told apart by icon, wording and fill. */
const PENDING: Style = {
  icon: Hourglass,
  variant: "outline",
  className: "border-dashed",
};
const DONE: Style = { icon: BadgeCheck, variant: "default" };
const REFUSED: Style = {
  icon: CircleSlash,
  variant: "outline",
  className: "text-muted-foreground",
};
const ENDED: Style = {
  icon: Undo2,
  variant: "secondary",
  className: "text-muted-foreground",
};

function StyledBadge({
  style,
  label,
  className,
}: {
  style: Style;
  label: string;
  className?: string;
}) {
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Badge>
  );
}

const SQU: Record<SquListState, Style> = {
  pending: PENDING,
  verified: DONE,
  rejected: REFUSED,
  revoked: ENDED,
};
export const SquStateBadge = ({ state }: { state: SquListState }) => (
  <StyledBadge style={SQU[state]} label={SQU_STATE_LABELS[state]} />
);

const LEADERSHIP: Record<LeadershipStatus, Style> = {
  pending: PENDING,
  approved: DONE,
  rejected: REFUSED,
  cancelled: ENDED,
};
export const LeadershipStatusBadge = ({
  status,
}: {
  status: LeadershipStatus;
}) => (
  <StyledBadge
    style={LEADERSHIP[status]}
    label={LEADERSHIP_STATUS_LABELS[status]}
  />
);

export const TeamStatusBadge = ({
  status,
}: {
  status: TeamSummary["status"];
}) =>
  status === "active" ? (
    <Badge variant="secondary">{TEAM_STATUS_LABELS.active}</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {TEAM_STATUS_LABELS[status]}
    </Badge>
  );
