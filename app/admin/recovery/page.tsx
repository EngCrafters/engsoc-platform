import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { AuthShell, authLinkClass } from "@/components/auth/auth-shell";
import { RecoveryForm } from "./recovery-form";

export default function AdminRecoveryPage() {
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
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Enter your committee account email. If it matches an account, we&apos;ll
        send a password reset link.
      </p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Resetting your password does not create an account or change which
        committees you can manage.
      </p>
      <div className="mt-6">
        <RecoveryForm />
      </div>
    </AuthShell>
  );
}
