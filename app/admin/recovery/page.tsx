import Link from "next/link";
import { RecoveryForm } from "./recovery-form";

export default function AdminRecoveryPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <section
        className="w-full rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8"
        aria-labelledby="recovery-title"
      >
        <h1
          id="recovery-title"
          className="text-2xl font-semibold tracking-tight"
        >
          Reset your password
        </h1>
        <p className="mt-3 text-sm text-neutral-700">
          Enter the email address for your provisioned committee account.
        </p>
        <div className="mt-6">
          <RecoveryForm />
        </div>
        <Link
          href="/admin/login"
          className="mt-5 inline-block text-sm font-medium underline underline-offset-4 hover:text-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900"
        >
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
