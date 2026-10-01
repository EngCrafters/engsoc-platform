import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import {
  AuthMessage,
  AuthShell,
  authLinkClass,
} from "@/components/auth/auth-shell";
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
        <div className="grid gap-2">
          <Link href="/admin/recovery" className={authLinkClass}>
            Forgot your password?
          </Link>
          <p>
            Event registration does not require an account.{" "}
            <Link href="/" className={authLinkClass}>
              Back to public site
            </Link>
          </p>
        </div>
      }
    >
      {params.auth === "failed" ? (
        <AuthMessage tone="error">
          This sign-in link is invalid or expired. Sign in again below.
        </AuthMessage>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        Use the account provisioned for your committee. Platform maintenance
        grants access; there is no self-signup.
      </p>
      <LoginForm next={next} />
    </AuthShell>
  );
}
