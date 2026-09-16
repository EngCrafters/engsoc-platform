import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "../actions";
import { getManagerContext } from "@/lib/auth/manager";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const manager = await getManagerContext();
  if (manager.kind === "anonymous") redirect("/admin/login?next=/admin/events");

  if (manager.kind === "unassigned") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
        <section
          className="w-full rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
          aria-labelledby="no-access-title"
        >
          <h1
            id="no-access-title"
            className="text-2xl font-semibold tracking-tight"
          >
            No committee access assigned
          </h1>
          <p className="mt-3 text-sm text-neutral-700">
            Your account is signed in, but it does not currently have a
            committee-manager grant. Contact the platform owner if this is
            unexpected.
          </p>
          <form action={logoutAction} className="mt-6">
            <button
              type="submit"
              className="min-h-11 rounded border border-neutral-300 px-4 text-sm font-medium hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              Sign out
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-neutral-200 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link
            href="/admin/events"
            className="font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900"
          >
            Engineering Society{" "}
            <span className="font-normal text-neutral-600">Administration</span>
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-11 rounded border border-neutral-300 px-3 text-sm font-medium hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
