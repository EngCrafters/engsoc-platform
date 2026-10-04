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
        className="w-full rounded-lg border p-6 sm:p-8"
        aria-labelledby="no-access-title"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ShieldAlert aria-hidden="true" className="size-5" />
        </span>
        <h1
          id="no-access-title"
          className="mt-4 text-2xl font-semibold tracking-tight"
        >
          Administrative access not assigned
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          You’re signed in, but this account does not currently have
          administrative access.
          {email ? (
            <>
              {" "}
              Signed in as <strong className="text-foreground">{email}</strong>.
            </>
          ) : null}
        </p>
        <ul className="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground">
          <li>
            Resetting your password will not restore access. It only changes how
            you sign in.
          </li>
          <li>
            Ask the Technical Team to assign the appropriate application role to
            this account.
          </li>
          <li>
            Once a grant exists, refresh this page. No new sign-in is needed.
          </li>
        </ul>
        <form action={logoutAction} className="mt-6">
          <Button type="submit" variant="outline">
            <LogOut aria-hidden="true" data-icon="inline-start" />
            Sign out
          </Button>
        </form>
      </section>
    </main>
  );
}
