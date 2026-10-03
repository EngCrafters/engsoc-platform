import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AuthAside } from "@/components/auth/auth-aside";
import { BrandMark } from "@/components/ui/brand-mark";
export { MessageBanner as AuthMessage } from "@/components/ui/message-banner";

/**
 * Shared frame for the signed-out admin screens (login, recovery, reset):
 * a quiet brand panel beside a plain form column, using the same tokens as
 * the admin workspace. See docs/DESIGN_SYSTEM.md.
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
    <main className="grid min-h-screen w-full bg-background text-foreground lg:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.2fr)]">
      <AuthAside
        heading="Plan, publish, and manage society events."
        description="Access is scoped to the committees assigned to your account."
      />
      <div className="flex min-w-0 flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8">
        <div className="flex w-full max-w-sm items-center justify-between gap-3 lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={32} />
            <span className="leading-tight">
              <span className="block text-sm font-semibold">
                Engineering Society
              </span>
              <span className="block text-xs text-muted-foreground">
                Committee workspace
              </span>
            </span>
          </div>
          <ThemeToggle />
        </div>
        <section
          aria-labelledby={titleId}
          className="flex w-full max-w-sm flex-col gap-6"
        >
          <div className="flex flex-col gap-2">
            <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
            <h1 id={titleId} className="text-2xl font-semibold tracking-tight">
              {title}
            </h1>
          </div>
          <div className="flex flex-col gap-4">{children}</div>
        </section>
        {footer ? (
          <div className="w-full max-w-sm text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export const authLinkClass =
  "rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";
