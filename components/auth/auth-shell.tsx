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
      <header className="absolute inset-x-0 top-0 z-20 flex items-center px-4 py-4 sm:px-8 sm:py-6">
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
      {/* The card is centered on the page on its own: the robot rises above it
          and the footer hangs below it, both absolutely positioned. On short
          screens the extra top padding keeps the robot from being clipped. */}
      <div className="flex flex-1 items-center justify-center px-4 pt-12 pb-20 [@media(max-height:820px)]:pt-52">
        <div className="relative w-full max-w-sm duration-500 animate-in fade-in-0 slide-in-from-bottom-3">
          <LoginMascot className="pointer-events-none absolute top-0 left-1/2 z-10 -translate-x-1/2" />
          <Card className="gap-0 bg-card px-6 pt-14 pb-6 sm:px-8 sm:pt-16 sm:pb-8">
            <section aria-labelledby={titleId} className="flex flex-col gap-5">
              <h1
                id={titleId}
                className="flex items-center justify-center gap-2.5 text-center text-2xl font-semibold tracking-tight"
              >
                <Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
                {title}
              </h1>
              <div className="flex flex-col gap-4">{children}</div>
            </section>
          </Card>
          {footer ? (
            <div className="absolute inset-x-0 top-full mt-6 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export const authLinkClass =
  "rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";
