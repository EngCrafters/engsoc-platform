"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestRecoveryAction } from "../actions";
import { initialRecoveryActionState } from "../action-state";

export function RecoveryForm() {
  const [state, action, pending] = useActionState(
    requestRecoveryAction,
    initialRecoveryActionState
  );
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.status === "sent" ? (
        <AuthMessage tone="success">
          If an account matches that address, a recovery email will be sent.
          Check your inbox and spam folder. Nothing here confirms whether an
          account exists.
        </AuthMessage>
      ) : null}
      {state.status === "error" ? (
        <AuthMessage tone="error">{state.message}</AuthMessage>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.status === "error" || undefined}
          className="h-11"
        />
      </div>
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : null}
        {pending ? "Sending…" : "Send recovery email"}
      </Button>
    </form>
  );
}
