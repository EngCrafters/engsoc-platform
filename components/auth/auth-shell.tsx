import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared frame for the signed-out admin screens (login, recovery, reset), built
 * from the same tokens as the admin shell so the two feel like one product.
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
      <aside className="hidden min-h-screen flex-col justify-between bg-shell px-10 py-10 text-shell-foreground lg:flex xl:px-16 xl:py-14">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-shell-accent font-mono text-sm font-semibold text-shell-accent-foreground">
            ES
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">
              Engineering Society
            </span>
            <span className="block text-xs text-shell-muted">
              Administration
            </span>
          </span>
        </div>
        <div className="max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-shell-accent">
            Committee workspace
          </p>
          <p className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.04em] xl:text-4xl">
            Plan, publish, and manage society events.
          </p>
          <p className="mt-5 text-sm leading-6 text-shell-muted">
            Access is scoped to the committees assigned to your account.
          </p>
        </div>
        <p className="text-xs text-shell-muted">Engineering Society Platform</p>
      </aside>
      <div className="flex min-w-0 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-8 flex w-full max-w-[28rem] items-center gap-3 lg:hidden">
          <span className="flex size-9 items-center justify-center rounded-lg bg-shell font-mono text-xs font-semibold text-shell-foreground">
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
        <section
          aria-labelledby={titleId}
          className="w-full max-w-[28rem] rounded-xl border border-border bg-surface p-6 shadow-panel duration-200 animate-in fade-in-0 slide-in-from-bottom-1 sm:p-9"
        >
          <span className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary-soft text-primary-soft-foreground">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <h1
            id={titleId}
            className="mt-5 text-[1.65rem] font-semibold tracking-[-0.04em]"
          >
            {title}
          </h1>
          {children}
        </section>
        {footer ? (
          <div className="mt-5 w-full max-w-[28rem] text-center text-sm leading-6 text-muted-foreground">
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
