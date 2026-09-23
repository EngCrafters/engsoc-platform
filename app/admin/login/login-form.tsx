"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { AuthMessage } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={failed || undefined}
          className="h-11"
        />
      </div>
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
      </div>
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p aria-live="polite" className="sr-only">
        {pending ? "Signing in" : ""}
      </p>
    </form>
  );
}
