import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BrandMark } from "@/components/ui/brand-mark";
import { Starfield } from "@/components/auth/starfield";
import { LoginMascot } from "@/components/auth/login-mascot";
export { MessageBanner as AuthMessage } from "@/components/ui/message-banner";

/**
 * Shared frame for the signed-out admin screens (login, recovery, reset): a
 * centered card over a galaxy. The screen is always dark (the `dark` class
 * scopes the dark tokens to this subtree) so the stars read as space in
 * either site theme. The galaxy is decorative and never carries content.
 * See docs/DESIGN_SYSTEM.md.
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
    <main className="dark relative isolate flex min-h-screen w-full flex-col overflow-hidden bg-[oklch(0.1_0_0)] text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <Starfield />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,oklch(0.05_0_0/0.7)_100%)]" />
      </div>
      <header className="flex items-center px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center gap-3">
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
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pt-4 pb-16">
        <div className="relative mt-32 w-full max-w-sm duration-500 animate-in fade-in-0 slide-in-from-bottom-3">
          <LoginMascot className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2" />
          <Card className="gap-0 bg-card px-6 pt-20 pb-6 sm:px-8 sm:pt-[5.5rem] sm:pb-8">
            <section aria-labelledby={titleId} className="flex flex-col gap-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="flex size-10 items-center justify-center rounded-full border bg-background/60">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h1
                  id={titleId}
                  className="text-2xl font-semibold tracking-tight"
                >
                  {title}
                </h1>
              </div>
              <div className="flex flex-col gap-4">{children}</div>
            </section>
          </Card>
        </div>
        {footer ? (
          <div className="w-full max-w-sm text-center text-sm text-muted-foreground duration-500 animate-in fade-in-0">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export const authLinkClass =
  "rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";
