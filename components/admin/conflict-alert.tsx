"use client";

import { AnimatePresence, motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DURATION, EASE_OUT } from "@/lib/motion/variants";

/**
 * Shown when a lifecycle or save action returns CONFLICT — the revision the
 * form submitted no longer matches the row, because another manager changed
 * it first. The optimistic-revision contract is authoritative in Postgres;
 * this is purely the recovery explanation, not a workaround for it.
 */
export function ConflictAlert({ onReload }: { onReload: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: DURATION.normal, ease: EASE_OUT }}
      >
        <Alert
          variant="destructive"
          className="border-warning/30 bg-warning-soft text-warning-soft-foreground [&>svg]:text-warning"
        >
          <RefreshCw aria-hidden="true" />
          <AlertTitle>This event changed elsewhere</AlertTitle>
          <AlertDescription className="text-warning-soft-foreground/90">
            <p>
              Another manager saved a newer revision while you were editing.
              Reload to see the current details, then reapply your change.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReload}
              className="mt-3 border-warning/40 bg-surface hover:bg-warning-soft"
            >
              <RefreshCw aria-hidden="true" />
              Reload latest revision
            </Button>
          </AlertDescription>
        </Alert>
      </motion.div>
    </AnimatePresence>
  );
}
