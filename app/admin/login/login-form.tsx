"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormActions, FormField } from "@/components/ui/form-field";
import { loginAction } from "../actions";
import { initialLoginActionState } from "../action-state";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    loginAction,
    initialLoginActionState
  );
  const failed = state.status === "error";

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
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
          aria-invalid={failed || undefined}
          className="h-11"
        />
      </FormField>
      <FormField htmlFor="password" label="Password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={failed || undefined}
          className="h-11"
        />
      </FormField>
      <FormActions>
        <Button type="submit" disabled={pending} className="h-11 w-full">
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </FormActions>
      <p aria-live="polite" className="sr-only">
        {pending ? "Signing in" : ""}
      </p>
    </form>
  );
}
