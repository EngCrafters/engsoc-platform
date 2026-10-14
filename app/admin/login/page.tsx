import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { AuthMessage, AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "./login-form";
import { safeAdminReturnPath } from "@/lib/auth/paths";

// The administration sign-in is reachable directly by an administrator, and by
// redirect from any protected page, but it is not a public destination and the
// public site no longer links to it.
// Kept out of search results.
// This is discoverability, not authorization: the route's own guards are what
// protect it. Search engines simply have no reason to index a sign-in page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
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
        <Link
          href="/"
          className="font-medium text-foreground/90 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Back to public site
        </Link>
      }
    >
      {params.reset === "success" ? (
        <AuthMessage tone="success">
          Your password was updated. Sign in with your new password.
        </AuthMessage>
      ) : null}
      {params.auth === "failed" ? (
        <AuthMessage tone="error">
          This sign-in link is invalid or expired. Sign in again below.
        </AuthMessage>
      ) : null}
      <p className="text-center text-sm text-muted-foreground">
        Use the account provisioned for your committee. Platform maintenance
        grants access; there is no self-signup.
      </p>
      <LoginForm next={next} />
    </AuthShell>
  );
}
