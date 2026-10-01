"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarPlus,
  Layers3,
  LogOut,
  Settings2,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandMark } from "@/components/ui/brand-mark";
import {
  adminNavigation,
  isAdminNavActive,
} from "@/components/admin/admin-navigation";

export function AdminSidebar({
  email,
  committees,
  logoutAction,
  onOpenSettings,
}: {
  email: string | null;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
  onOpenSettings: (trigger: HTMLButtonElement) => void;
}) {
  const pathname = usePathname();
  const scopeLabel = committees.map((committee) => committee.name).join(", ");

  return (
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:shrink-0 lg:flex-col lg:border-r lg:border-shell-border lg:bg-shell lg:text-shell-foreground">
      <div className="px-5 pb-6 pt-5">
        <Link
          href="/admin/events"
          className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-shell-accent"
        >
          <BrandMark size={36} />
          <span className="min-w-0 truncate text-sm font-semibold tracking-tight">
            Engineering Society
          </span>
        </Link>
      </div>

      <nav aria-label="Administration" className="flex-1 px-3">
        <Link
          href="/admin/events/new"
          aria-current={pathname === "/admin/events/new" ? "page" : undefined}
          className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-shell-accent px-3 text-sm font-semibold text-shell-accent-foreground transition-colors hover:bg-shell-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
        >
          <CalendarPlus
            aria-hidden="true"
            className="size-[1.125rem]"
            strokeWidth={1.8}
          />
          Create event
        </Link>
        <ul className="mt-5 grid gap-1">
          {adminNavigation.map((link) => {
            const active = isAdminNavActive(pathname, link.href);
            const Icon = link.icon;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
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
                  <span className="truncate">{link.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => onOpenSettings(event.currentTarget)}
              className={cn(
                "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent",
                pathname === "/admin/account"
                  ? "bg-shell-foreground/10 text-shell-foreground"
                  : "text-shell-muted hover:bg-shell-foreground/[0.06] hover:text-shell-foreground"
              )}
            >
              <Settings2
                aria-hidden="true"
                className="size-[1.125rem] shrink-0"
                strokeWidth={1.8}
              />
              <span>Settings</span>
            </button>
          </li>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="submit"
                  aria-label="Sign out"
                  className="flex size-9 items-center justify-center rounded-lg text-shell-foreground/85 transition-colors hover:bg-shell-foreground/[0.08] hover:text-shell-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
                >
                  <LogOut
                    aria-hidden="true"
                    className="size-[1.125rem]"
                    strokeWidth={1.8}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          </form>
        </div>
      </div>
    </aside>
  );
}
