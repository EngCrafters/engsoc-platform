import Link from "next/link";
import { LoginForm } from "./login-form";
import { safeAdminReturnPath } from "@/lib/auth/paths";

export default async function AdminLoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  const params = await searchParams;
  const next = safeAdminReturnPath(
    typeof params.next === "string" ? params.next : undefined
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <section
        className="w-full rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8"
        aria-labelledby="admin-login-title"
      >
        <p className="text-sm font-medium text-neutral-600">
          Engineering Society
        </p>
        <h1
          id="admin-login-title"
          className="mt-1 text-2xl font-semibold tracking-tight"
        >
          Committee administration
        </h1>
        <p className="mt-3 text-sm text-neutral-700">
          Sign in with the account provisioned for your committee. Public
          registration does not require an account.
        </p>
        <div className="mt-6">
          <LoginForm next={next} />
        </div>
        <Link
          href="/admin/recovery"
          className="mt-5 inline-block text-sm font-medium underline underline-offset-4 hover:text-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900"
        >
          Forgot your password?
        </Link>
      </section>
    </main>
  );
}
