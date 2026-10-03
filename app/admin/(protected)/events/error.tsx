"use client";

import { RotateCw } from "lucide-react";
import { ErrorState } from "@/components/admin/error-state";
import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Events could not load"
      description="Your session is still protected. Try loading the events again."
      action={
        <Button variant="outline" onClick={reset}>
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          Try again
        </Button>
      }
    />
  );
}
