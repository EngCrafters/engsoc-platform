import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { AuthShell, authLinkClass } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-shell";
import { RecoveryForm } from "./recovery-form";

export default async function AdminRecoveryPage({
  searchParams,
}: PageProps<"/admin/recovery">) {
  const params = await searchParams;
  return (
    <AuthShell
      icon={KeyRound}
      title="Reset your password"
      titleId="recovery-title"
      footer={
        <Link
          href="/admin/login"
          className={`${authLinkClass} inline-flex items-center gap-1.5`}
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Back to sign in
        </Link>
      }
    >
      {params.link === "invalid" ? (
        <AuthMessage tone="error">
          This recovery link is invalid or expired. Request a new email below
          and use its most recent link.
        </AuthMessage>
      ) : null}
      <p className="text-center text-sm text-muted-foreground">
        Enter your committee account email. If it matches an account, we&apos;ll
        send a password reset link. Resetting your password does not create an
        account or change which committees you can manage.
      </p>
      <RecoveryForm />
    </AuthShell>
  );
}
