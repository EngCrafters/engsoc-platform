"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormActions, FormField } from "@/components/ui/form-field";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/auth/callback";
import { resetPasswordAction } from "./actions";
import { initialResetActionState } from "./action-state";

export function ResetForm() {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    initialResetActionState
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const failed = state.status !== "idle" || localError !== null;

  if (state.status === "expired") {
    return (
      <div className="grid gap-4">
        <AuthMessage tone="error">{state.message}</AuthMessage>
        <Button asChild className="h-10 w-full">
          <Link href="/admin/recovery">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        const problem = validateNewPassword(
          data.get("password") as string | null,
          data.get("confirmPassword") as string | null
        );
        setLocalError(problem);
        if (problem) event.preventDefault();
      }}
    >
      {localError ? (
        <AuthMessage tone="error">{localError}</AuthMessage>
      ) : state.status === "error" ? (
        <AuthMessage tone="error">{state.message}</AuthMessage>
      ) : null}
      <FormField
        htmlFor="password"
        label="New password"
        description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={failed || undefined}
          aria-describedby="password-description"
          className="h-10"
        />
      </FormField>
      <FormField htmlFor="confirmPassword" label="Confirm new password">
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={failed || undefined}
          className="h-10"
        />
      </FormField>
      <FormActions>
        <Button type="submit" disabled={pending} className="h-10 w-full">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Updating password…" : "Update password"}
        </Button>
      </FormActions>
      <p aria-live="polite" className="sr-only">
        {pending ? "Updating password" : ""}
      </p>
    </form>
  );
}
