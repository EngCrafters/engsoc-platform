"use client";

import Link from "next/link";
import { LogIn, RotateCw } from "lucide-react";
import { ErrorState } from "@/components/admin/error-state";
import { Button } from "@/components/ui/button";

/**
 * The dashboard could not confirm who is signed in or what they may do: Supabase Auth or the
 * database did not answer while the protected layout checked access. Nothing is shown and nothing
 * is retried automatically, so a failure can never become a reload loop; the person chooses to
 * try again or to return to sign-in. Access stays refused until the check succeeds.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  // Server errors arrive with a generic message and a digest that matches the server log.
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : null;
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-10">
      <ErrorState
        className="w-full"
        title="The dashboard couldn’t load"
        description={`Your access couldn’t be confirmed just now, so nothing was shown. Try again in a moment.${digest ? ` Reference: ${digest}.` : ""}`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => retry()}>
              <RotateCw aria-hidden="true" data-icon="inline-start" />
              Try again
            </Button>
            <Button asChild variant="ghost">
              <Link href="/admin/login">
                <LogIn aria-hidden="true" data-icon="inline-start" />
                Back to sign-in
              </Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
