"use client";

import { useActionState } from "react";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormActions, FormField } from "@/components/ui/form-field";
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
      <FormField htmlFor="email" label="Email address">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.status === "error" || undefined}
          className="h-10"
        />
      </FormField>
      <FormActions>
        <Button type="submit" disabled={pending} className="h-10 w-full">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Sending…" : "Send recovery email"}
        </Button>
      </FormActions>
    </form>
  );
}
