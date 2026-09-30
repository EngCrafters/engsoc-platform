"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  CalendarDays,
  CalendarPlus,
  LogOut,
  Menu,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { listItem, listStagger } from "@/lib/motion/variants";

const links = [
  { href: "/admin/events", label: "Events", icon: CalendarDays },
  { href: "/admin/events/new", label: "Create event", icon: CalendarPlus },
  { href: "/admin/account", label: "Account & security", icon: ShieldCheck },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin/events/new" || href === "/admin/account") {
    return pathname === href;
  }
  return (
    pathname === "/admin/events" ||
    /^\/admin\/events\/[0-9a-f-]+$/i.test(pathname)
  );
}

function currentLabel(pathname: string) {
  return links.find((link) => isActive(pathname, link.href))?.label ?? "Events";
}

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

  return (
    <header className="flex items-center justify-between gap-3 border-b border-shell-border bg-shell px-4 py-3 text-shell-foreground lg:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-shell-accent text-shell-accent-foreground font-mono text-[0.65rem] font-semibold">
          ES
        </span>
        <p className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {currentLabel(pathname)}
        </p>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open administration menu"
            className="text-shell-foreground/90 hover:bg-white/[0.08] hover:text-shell-foreground"
          >
            <Menu aria-hidden="true" className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[85%] border-shell-border bg-shell p-0 text-shell-foreground"
        >
          <SheetHeader className="border-b border-shell-border px-5 py-5">
            <div className="flex items-start justify-between gap-2">
              <SheetTitle className="text-shell-foreground">
                Engineering Society
              </SheetTitle>
              <ThemeToggle variant="shell" />
            </div>
            <p className="text-xs text-shell-muted">Administration</p>
            <p className="mt-2 truncate text-xs text-shell-foreground/90">
              {email ?? "Signed in"}
              <span className="text-shell-muted"> · Committee manager</span>
            </p>
          </SheetHeader>
          <motion.nav
            aria-label="Administration"
            className="flex-1 px-3 py-5"
            initial="initial"
            animate={open ? "animate" : "initial"}
            variants={listStagger}
          >
            <p className="mb-2 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-shell-muted">
              Workspace
            </p>
            <ul className="grid gap-1">
              {links.map((link) => {
                const active = isActive(pathname, link.href);
                const Icon = link.icon;
                return (
                  <motion.li key={link.href} variants={listItem}>
                    <SheetClose asChild>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-12 items-center gap-3 rounded-lg px-3 text-[0.95rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
                          active
                            ? "bg-white/[0.1] text-shell-foreground shadow-[inset_2px_0_0_var(--shell-accent)]"
                            : "text-shell-muted hover:bg-white/[0.06] hover:text-shell-foreground"
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                        {link.label}
                      </Link>
                    </SheetClose>
                  </motion.li>
                );
              })}
            </ul>
            {committees.length > 0 ? (
              <motion.div variants={listItem} className="mt-5 px-3">
                <p className="text-[0.68rem] font-medium tracking-wide text-shell-muted">
                  Committee scope
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {committees.map((committee) => (
                    <li
                      key={committee.id}
                      className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-shell-foreground/90"
                    >
                      {committee.name}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </motion.nav>
          <form
            action={logoutAction}
            className="border-t border-shell-border p-3"
          >
            <Button
              type="submit"
              variant="ghost"
              className="w-full min-h-12 justify-start gap-3 text-shell-foreground/85 hover:bg-white/[0.08] hover:text-shell-foreground"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </header>
  );
}
