"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "./actions";
import { initialResetActionState } from "./action-state";

export function ResetForm() {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    initialResetActionState
  );
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.status === "error" ? (
        <AuthMessage tone="error">{state.message}</AuthMessage>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={state.status === "error" || undefined}
          aria-describedby="password-hint"
          className="h-11"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 12 characters.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : null}
        {pending ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
