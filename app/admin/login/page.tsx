import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { AuthShell, authLinkClass } from "@/components/auth/auth-shell";
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
    <AuthShell
      icon={LockKeyhole}
      title="Committee administration"
      titleId="admin-login-title"
      footer={
        <p>
          Event registration does not require an account.
          <br />
          <Link href="/" className={authLinkClass}>
            Back to public site
          </Link>
        </p>
      }
    >
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Use the account provisioned for your committee. Platform maintenance
        grants access; there is no self-signup.
      </p>
      <div className="mt-6">
        <LoginForm next={next} />
      </div>
      <Link
        href="/admin/recovery"
        className={`${authLinkClass} mt-5 inline-block text-sm`}
      >
        Forgot your password?
      </Link>
    </AuthShell>
  );
}
