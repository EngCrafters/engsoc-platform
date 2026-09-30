"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  CalendarDays,
  CalendarPlus,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DURATION, EASE_OUT } from "@/lib/motion/variants";

const managementLinks = [
  { href: "/admin/events", label: "Events", icon: CalendarDays },
  { href: "/admin/events/new", label: "Create event", icon: CalendarPlus },
];
const accountLink = {
  href: "/admin/account",
  label: "Account & security",
  icon: ShieldCheck,
};

function isActive(pathname: string, href: string) {
  if (href === "/admin/events/new" || href === "/admin/account") {
    return pathname === href;
  }
  return (
    pathname === "/admin/events" ||
    /^\/admin\/events\/[0-9a-f-]+$/i.test(pathname)
  );
}

export function AdminSidebar({
  email,
  committees,
  logoutAction,
}: {
  email: string | null;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[16.25rem] lg:shrink-0 lg:flex-col lg:border-r lg:border-shell-border lg:bg-shell lg:text-shell-foreground">
      <div className="border-b border-shell-border px-5 py-6">
        <Link
          href="/admin/events"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-shell-accent"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-shell-accent text-shell-accent-foreground font-mono text-xs font-semibold">
            ES
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold tracking-tight">
              Engineering Society
            </span>
            <span className="block text-xs text-shell-muted">
              Administration
            </span>
          </span>
        </Link>
      </div>

      <nav aria-label="Administration" className="flex-1 px-3 pt-6">
        <p className="mb-2 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-shell-muted">
          Workspace
        </p>
        <ul className="grid gap-1">
          {managementLinks.map((link) => {
            const active = isActive(pathname, link.href);
            const Icon = link.icon;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
                    active
                      ? "bg-white/[0.1] text-shell-foreground"
                      : "text-shell-muted hover:bg-white/[0.06] hover:text-shell-foreground"
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="admin-nav-active"
                      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-shell-accent"
                      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
                    />
                  ) : null}
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "relative z-10 size-[1.125rem] shrink-0",
                      active && "text-shell-accent"
                    )}
                  />
                  <span className="relative z-10 truncate">{link.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mb-2 mt-8 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-shell-muted">
          Settings
        </p>
        <Link
          href={accountLink.href}
          aria-current={
            isActive(pathname, accountLink.href) ? "page" : undefined
          }
          className={cn(
            "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
            isActive(pathname, accountLink.href)
              ? "bg-white/[0.1] text-shell-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-shell-accent"
              : "text-shell-muted hover:bg-white/[0.06] hover:text-shell-foreground"
          )}
        >
          <ShieldCheck
            aria-hidden="true"
            className="size-[1.125rem] shrink-0"
          />
          {accountLink.label}
        </Link>
      </nav>

      {committees.length > 0 ? (
        <div className="px-5 pb-4">
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
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-shell-border px-4 py-3">
        <span className="text-[0.68rem] font-medium tracking-wide text-shell-muted">
          Appearance
        </span>
        <ThemeToggle
          variant="shell"
          triggerClassName="text-shell-foreground/85 hover:bg-white/[0.08] hover:text-shell-foreground focus-visible:outline-shell-accent"
        />
      </div>

      <div className="flex items-center gap-2.5 border-t border-shell-border px-4 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-shell-foreground/90">
          <UserRound aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span
            className="block truncate text-xs font-medium text-shell-foreground"
            title={email ?? undefined}
          >
            {email ?? "Signed in"}
          </span>
          <span className="block truncate text-[0.68rem] text-shell-muted">
            Committee manager
          </span>
        </span>
        <form action={logoutAction}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="submit"
                aria-label="Sign out"
                className="flex size-9 items-center justify-center rounded-lg text-shell-foreground/85 transition-colors hover:bg-white/[0.08] hover:text-shell-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
              >
                <LogOut aria-hidden="true" className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </form>
      </div>
    </aside>
  );
}
