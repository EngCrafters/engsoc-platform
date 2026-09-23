import { LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NoAccessState({
  email,
  logoutAction,
}: {
  email: string | null;
  logoutAction: () => void | Promise<void>;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-10">
      <section
        className="w-full rounded-xl border border-border bg-surface p-6 shadow-raised sm:p-8"
        aria-labelledby="no-access-title"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
          <ShieldAlert aria-hidden="true" className="size-5" />
        </span>
        <h1
          id="no-access-title"
          className="mt-4 text-2xl font-semibold tracking-tight"
        >
          No committee access assigned
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Signing in worked
          {email ? (
            <>
              {" "}
              as <strong className="text-foreground">{email}</strong>
            </>
          ) : null}
          , but this account does not have an active committee-manager grant.
          This is an access issue, not a sign-in problem.
        </p>
        <ul className="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground">
          <li>
            Resetting your password will not restore access. It only changes how
            you sign in.
          </li>
          <li>
            Access is granted, and taken away, by the platform maintenance
            authority: the person or team who looks after the Engineering
            Society platform’s hosting and database accounts. Ask them to give
            this account the committee it needs, and quote the email above.
          </li>
          <li>
            Once a grant exists, refresh this page. No new sign-in is needed.
          </li>
        </ul>
        <form action={logoutAction} className="mt-6">
          <Button type="submit" variant="outline" className="h-11 px-4">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </section>
    </main>
  );
}
