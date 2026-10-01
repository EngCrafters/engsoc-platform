"use client";

import { Palette, ShieldCheck, X } from "lucide-react";
import { AccountOverview } from "@/components/admin/account-overview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

export type SettingsSection = "account" | "appearance";

const sections = [
  {
    id: "account",
    label: "Account & security",
    description: "Your identity, committee access, and sign-in security.",
    icon: ShieldCheck,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Choose how the platform looks on this device.",
    icon: Palette,
  },
] as const;

function AppearanceSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Color theme</CardTitle>
        <CardDescription>
          Switch between light and dark mode with one click.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium">Theme</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            The theme switch is also available in the admin sidebar.
          </p>
        </div>
        <ThemeToggle />
      </CardContent>
    </Card>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  restoreFocus,
  email,
  userId,
  committees,
  logoutAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  restoreFocus: () => void;
  email: string | null;
  userId: string;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
}) {
  const currentSection =
    sections.find((item) => item.id === section) ?? sections[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        className="flex h-[calc(100dvh-2rem)] max-h-[44rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-[56rem]"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your account, security, and appearance settings.
        </DialogDescription>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div>
            <p className="text-xs text-muted-foreground">Engineering Society</p>
            <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-lg" aria-label="Close settings">
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="shrink-0 border-b border-shell-border bg-shell px-3 py-3 text-shell-foreground sm:w-56 sm:border-b-0 sm:border-r sm:py-5">
            <nav aria-label="Settings sections" className="grid gap-1">
              {sections.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={section === item.id ? "true" : undefined}
                    onClick={() => onSectionChange(item.id)}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
                      section === item.id
                        ? "bg-shell-foreground/10 text-shell-foreground"
                        : "text-shell-muted hover:bg-shell-foreground/[0.06] hover:text-shell-foreground"
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className="size-[1.125rem] shrink-0"
                      strokeWidth={1.8}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
          <section
            aria-label={currentSection.label}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          >
            <div className="border-b border-border px-4 py-4 sm:px-6">
              <h3 className="text-base font-semibold tracking-tight">
                {currentSection.label}
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {currentSection.description}
              </p>
            </div>
            <div className="p-4 sm:p-6">
              {section === "account" ? (
                <AccountOverview
                  compact
                  idPrefix="settings-account"
                  email={email}
                  userId={userId}
                  committees={committees}
                  logoutAction={logoutAction}
                />
              ) : (
                <AppearanceSettings />
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
