import { ResetForm } from "./reset-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <section
        className="w-full rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8"
        aria-labelledby="reset-title"
      >
        <h1 id="reset-title" className="text-2xl font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="mt-3 text-sm text-neutral-700">
          Use a password with at least 12 characters.
        </p>
        <div className="mt-6">
          <ResetForm />
        </div>
      </section>
    </main>
  );
}
