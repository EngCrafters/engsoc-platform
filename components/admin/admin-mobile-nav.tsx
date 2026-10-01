"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarPlus,
  Layers3,
  LogOut,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandMark } from "@/components/ui/brand-mark";
import {
  adminNavigation,
  adminPageLabel,
  isAdminNavActive,
} from "@/components/admin/admin-navigation";

export function AdminMobileNav({
  email,
  committees,
  logoutAction,
}: {
  email: string | null;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const scopeLabel = committees.map((committee) => committee.name).join(", ");

  return (
    <header className="flex items-center justify-between gap-3 border-b border-shell-border bg-shell px-4 py-3 text-shell-foreground lg:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark size={32} alt="Engineering Society" />
        <p className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {adminPageLabel(pathname)}
        </p>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Open administration menu"
            className="text-shell-foreground/90 hover:bg-shell-foreground/[0.08] hover:text-shell-foreground"
          >
            <Menu aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[85%] gap-0 border-shell-border bg-shell p-0 text-shell-foreground"
        >
          <SheetHeader className="border-b border-shell-border px-5 py-5">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="flex items-center gap-2.5 text-sm font-semibold text-shell-foreground">
                <BrandMark size={32} />
                Engineering Society
              </SheetTitle>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Close administration menu"
                  className="text-shell-foreground/85 hover:bg-shell-foreground/[0.08] hover:text-shell-foreground"
                >
                  <X aria-hidden="true" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>
          <nav aria-label="Administration" className="flex-1 px-3 py-5">
            <SheetClose asChild>
              <Link
                href="/admin/events/new"
                aria-current={
                  pathname === "/admin/events/new" ? "page" : undefined
                }
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-shell-accent px-3 text-sm font-semibold text-shell-accent-foreground"
              >
                <CalendarPlus
                  aria-hidden="true"
                  className="size-[1.125rem]"
                  strokeWidth={1.8}
                />
                Create event
              </Link>
            </SheetClose>
            <ul className="mt-5 grid gap-1">
              {adminNavigation.map((link) => {
                const active = isAdminNavActive(pathname, link.href);
                const Icon = link.icon;
                return (
                  <li key={link.href}>
                    <SheetClose asChild>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
                          active
                            ? "bg-shell-foreground/10 text-shell-foreground"
                            : "text-shell-muted hover:bg-shell-foreground/[0.06] hover:text-shell-foreground"
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className="size-[1.125rem] shrink-0"
                          strokeWidth={1.8}
                        />
                        {link.label}
                      </Link>
                    </SheetClose>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t border-shell-border px-3 py-3">
            {committees.length > 0 ? (
              <Badge
                variant="shell"
                role="note"
                aria-label={`Committee scope: ${scopeLabel}`}
                title={scopeLabel}
                className="mb-3 max-w-full"
              >
                <Layers3 aria-hidden="true" />
                <span className="text-shell-muted">Scope</span>
                <span className="min-w-0 truncate">{committees[0].name}</span>
                {committees.length > 1 ? (
                  <span>+{committees.length - 1}</span>
                ) : null}
              </Badge>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-shell-foreground/[0.08] text-shell-foreground">
                <UserRound
                  aria-hidden="true"
                  className="size-4"
                  strokeWidth={1.8}
                />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span
                  className="block truncate text-xs font-medium"
                  title={email ?? undefined}
                >
                  {email ?? "Signed in"}
                </span>
                <span className="block truncate text-xs text-shell-muted">
                  Committee manager
                </span>
              </span>
              <ThemeToggle variant="shell" />
              <form action={logoutAction}>
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="flex size-9 items-center justify-center rounded-lg text-shell-foreground/85 transition-colors hover:bg-shell-foreground/[0.08] hover:text-shell-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
                >
                  <LogOut
                    aria-hidden="true"
                    className="size-[1.125rem]"
                    strokeWidth={1.8}
                  />
                </button>
              </form>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
