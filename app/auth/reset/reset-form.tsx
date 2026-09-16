"use client";

import { useActionState } from "react";
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
        <p
          role="alert"
          className="rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {state.message}
        </p>
      ) : null}
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="mt-1 min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60"
      >
        {pending ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}
