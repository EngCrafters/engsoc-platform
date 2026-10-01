import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AmbientGlow } from "@/components/ui/ambient-glow";
import { AuthAside } from "@/components/auth/auth-aside";

/**
 * Shared frame for the signed-out admin screens (login, recovery, reset), built
 * from the same tokens as the admin shell so the two feel like one product.
 * See docs/DESIGN_SYSTEM.md "Auth surfaces" for the glass card and
 * Liquid/GSAP usage rules.
 */
export function AuthShell({
  icon: Icon,
  title,
  titleId,
  children,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  titleId: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen w-full bg-background text-foreground lg:grid-cols-[minmax(19rem,0.82fr)_minmax(0,1.18fr)]">
      <AuthAside
        eyebrow="Committee workspace"
        heading="Plan, publish, and manage society events."
        description="Access is scoped to the committees assigned to your account."
      />
      <div className="relative flex min-w-0 flex-col items-center justify-center gap-6 overflow-hidden px-4 py-10 sm:px-8">
        <AmbientGlow />
        <div className="flex w-full max-w-[26rem] items-center justify-between gap-3 lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-shell font-mono text-xs font-semibold text-shell-foreground">
              ES
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">
                Engineering Society
              </span>
              <span className="block text-xs text-muted-foreground">
                Administration
              </span>
            </span>
          </div>
          <ThemeToggle />
        </div>
        <Card
          variant="glass"
          className="w-full max-w-[26rem] p-6 duration-200 animate-in fade-in-0 slide-in-from-bottom-1 sm:p-8"
        >
          <section aria-labelledby={titleId} className="grid gap-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-foreground/15 text-foreground/70">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <h1
                id={titleId}
                className="text-xl font-semibold tracking-[-0.03em]"
              >
                {title}
              </h1>
            </div>
            <div className="grid gap-4">{children}</div>
          </section>
        </Card>
        {footer ? (
          <div className="w-full max-w-[26rem] text-center text-sm leading-6 text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function AuthMessage({
  tone,
  children,
  className,
}: {
  tone: "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-lg border p-3 text-sm leading-6 duration-200 animate-in fade-in-0",
        tone === "error"
          ? "border-danger/30 bg-danger-soft text-danger-soft-foreground"
          : "border-success/30 bg-success-soft text-success-soft-foreground",
        className
      )}
    >
      <Icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

export const authLinkClass =
  "rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";
