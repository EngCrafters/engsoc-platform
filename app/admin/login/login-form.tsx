"use client";

import { useActionState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { FormActions, FormField } from "@/components/ui/form-field";
import { loginAction } from "../actions";
import { initialLoginActionState } from "../action-state";

const forgotPasswordLinkClass =
  "text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

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
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={failed || undefined}
          className="h-11"
        />
        <Link
          href="/admin/recovery"
          className={cn(forgotPasswordLinkClass, "justify-self-end")}
        >
          Forgot your password?
        </Link>
      </div>
      <FormActions>
        <Button type="submit" disabled={pending} className="h-11 w-full">
          {pending ? <Spinner /> : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </FormActions>
      <p aria-live="polite" className="sr-only">
        {pending ? "Signing in" : ""}
      </p>
    </form>
  );
}
