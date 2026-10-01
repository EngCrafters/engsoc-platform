"use client";

import { useActionState } from "react";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormActions, FormField } from "@/components/ui/form-field";
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
      <FormField
        htmlFor="password"
        label="New password"
        description="At least 12 characters."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={state.status === "error" || undefined}
          aria-describedby="password-description"
          className="h-11"
        />
      </FormField>
      <FormActions>
        <Button type="submit" disabled={pending} className="h-11 w-full">
          {pending ? <Spinner /> : null}
          {pending ? "Resetting…" : "Reset password"}
        </Button>
      </FormActions>
    </form>
  );
}
