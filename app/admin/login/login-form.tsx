"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";
import { initialLoginActionState } from "../action-state";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    loginAction,
    initialLoginActionState
  );

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {state.message}
        </p>
      ) : null}
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p aria-live="polite" className="sr-only">
        {pending ? "Signing in" : ""}
      </p>
    </form>
  );
}
