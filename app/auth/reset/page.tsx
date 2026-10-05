import Link from "next/link";
import { ShieldCheck, TimerOff } from "lucide-react";
import {
  AuthMessage,
  AuthShell,
  authLinkClass,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { createAuthServerClient } from "@/lib/auth/server";
import { RECOVERY_EXPIRED_MESSAGE } from "@/lib/auth/callback";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

/** True only when the visitor holds a live session (from a verified email link). */
async function hasRecoverySession() {
  try {
    const supabase = await createAuthServerClient();
    const { data, error } = await supabase.auth.getUser();
    return !error && Boolean(data.user);
  } catch {
    return false;
  }
}

export default async function ResetPasswordPage() {
  if (!(await hasRecoverySession())) {
    return (
      <AuthShell
        icon={TimerOff}
        title="Reset link unavailable"
        titleId="reset-expired-title"
        footer={
          <Link href="/admin/login" className={authLinkClass}>
            Back to sign in
          </Link>
        }
      >
        <AuthMessage tone="error">{RECOVERY_EXPIRED_MESSAGE}</AuthMessage>
        <Button asChild className="h-10 w-full">
          <Link href="/admin/recovery">Request a new link</Link>
        </Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      icon={ShieldCheck}
      title="Choose a new password"
      titleId="reset-title"
    >
      <p className="text-center text-sm text-muted-foreground">
        Use a password with at least 12 characters. This changes your sign-in
        password only; your committee access stays exactly as it was.
      </p>
      <ResetForm />
    </AuthShell>
  );
}
