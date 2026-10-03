import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { StatePanel } from "@/components/ui/state-panel";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StatePanel
      icon={icon}
      title={title}
      titleId="empty-state-title"
      description={description}
      action={action}
      className={className}
    />
  );
}
