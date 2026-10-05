"use client";

import { useActionState, useEffect } from "react";
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
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/callback";
import { setTemporaryPasswordAction } from "./user-actions";
import { initialUserActionState } from "./user-state";
import type { UserRecord } from "./user-types";

/**
 * Technical-only fallback. Passwords are write-only: the field is never
 * pre-filled, never echoed, and the server answers only "changed" or an error.
 */
export function PasswordDialog({
  user,
  onClose,
}: {
  user: UserRecord | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      {user ? (
        <PasswordForm key={user.userId} user={user} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function PasswordForm({
  user,
  onClose,
}: {
  user: UserRecord;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    setTemporaryPasswordAction,
    initialUserActionState
  );
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Set temporary password</DialogTitle>
        <DialogDescription>
          For {user.email}. Share the password privately and ask them to change
          it. It is never shown again and is not stored in the audit. Prefer
          sending a reset email whenever delivery works.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="grid gap-4" autoComplete="off">
        <input type="hidden" name="userId" value={user.userId} />
        <div className="grid gap-1.5">
          <Label htmlFor="temp-password">New password</Label>
          <Input
            id="temp-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <p className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="temp-confirm">Confirm password</Label>
          <Input
            id="temp-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
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
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Changing…" : "Change password"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
