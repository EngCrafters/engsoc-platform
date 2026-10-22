"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  accessSuspensionAction,
  type AdminActionState,
} from "../administration/actions";

export type SuspensionTarget = {
  userId: string;
  email: string;
  suspend: boolean;
  role: string;
};

const initial: AdminActionState = { status: "idle" };

/**
 * Suspend (revoke now, remembering role and committee) or reactivate exactly what was
 * suspended (ADR 0024). The database decides who may do either.
 */
export function SuspensionDialog({
  target,
  onClose,
}: {
  target: SuspensionTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SuspensionForm
          key={`${target.userId}-${target.suspend}`}
          target={target}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function SuspensionForm({
  target,
  onClose,
}: {
  target: SuspensionTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (previous: AdminActionState, form: FormData) => {
      const result = await accessSuspensionAction(previous, form);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
        router.refresh();
      }
      return result;
    },
    initial
  );
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {target.suspend ? "Suspend access" : "Reactivate access"}
        </DialogTitle>
        <DialogDescription>
          {target.email} · {target.role}.{" "}
          {target.suspend
            ? "Access ends on the account's next request. The role and committee are remembered, so it can be reactivated exactly as it was."
            : "Restores the suspended role and committee. The account can use the dashboard again immediately."}
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="grid gap-4">
        <input type="hidden" name="userId" value={target.userId} />
        <input type="hidden" name="suspend" value={String(target.suspend)} />
        <div className="grid gap-1.5">
          <Label htmlFor="suspension-note">Note (optional)</Label>
          <Input
            id="suspension-note"
            name="note"
            maxLength={200}
            placeholder="Reason, for the access history"
          />
        </div>
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={target.suspend ? "destructive" : "default"}
            disabled={pending}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending
              ? "Saving…"
              : target.suspend
                ? "Suspend access"
                : "Reactivate access"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
