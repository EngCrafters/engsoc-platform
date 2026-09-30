import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { StatePanel } from "@/components/ui/state-panel";

export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StatePanel
      icon={AlertTriangle}
      title={title}
      titleAs="h1"
      description={description}
      action={action}
      tone="danger"
      role="alert"
      className={className}
    />
  );
}
