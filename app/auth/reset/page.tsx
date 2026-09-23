import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "./reset-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell
      icon={ShieldCheck}
      title="Choose a new password"
      titleId="reset-title"
    >
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Use a password with at least 12 characters. This changes your sign-in
        password only; your committee access stays exactly as it was.
      </p>
      <div className="mt-6">
        <ResetForm />
      </div>
    </AuthShell>
  );
}
