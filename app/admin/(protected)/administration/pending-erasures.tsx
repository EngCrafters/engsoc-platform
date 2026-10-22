"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { PendingErasure } from "@/lib/administration/server";
import { formatWhen } from "@/lib/administration/labels";
import { retryErasureAction } from "./deletion-actions";

/** Erasures whose sign-in identity Supabase Auth has not confirmed deleting yet. */
export function PendingErasures({ erasures }: { erasures: PendingErasure[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <p>
        <span className="font-medium tabular-nums">{erasures.length}</span>{" "}
        account {erasures.length === 1 ? "erasure is" : "erasures are"} waiting
        for Supabase Auth to delete the sign-in identity. Their data is already
        removed.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {erasures.map((erasure) => (
          <li
            key={erasure.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs">
                {erasure.email ?? "Identity already gone"}
              </span>
              <span className="text-xs text-muted-foreground">
                Requested {formatWhen(erasure.requestedAt)} · {erasure.attempts}{" "}
                confirmation {erasure.attempts === 1 ? "attempt" : "attempts"}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await retryErasureAction(erasure.id);
                  if (result.ok) toast.success(result.message);
                  else toast.error(result.message);
                  router.refresh();
                })
              }
            >
              {pending ? <Spinner /> : null}
              Retry deletion
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
