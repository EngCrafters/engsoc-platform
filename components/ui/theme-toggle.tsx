"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

/**
 * Theme toggle. `variant="shell"` styles the trigger for the dark navy
 * admin shell; the default styles it for a light `surface` background
 * (auth pages). See docs/DESIGN_SYSTEM.md "Theming".
 */
export function ThemeToggle({
  variant = "default",
  triggerClassName,
}: {
  variant?: "default" | "shell";
  triggerClassName?: string;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const active = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[2];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change theme"
        className={cn(
          "flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          variant === "shell"
            ? "text-shell-foreground/85 hover:bg-white/[0.08] hover:text-shell-foreground focus-visible:outline-shell-accent"
            : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring",
          triggerClassName
        )}
      >
        {mounted ? (
          <ActiveIcon aria-hidden="true" className="size-4" />
        ) : (
          <span className="size-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = mounted && theme === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setTheme(option.value)}
            >
              <Icon aria-hidden="true" className="size-4" />
              {option.label}
              {selected ? (
                <Check aria-hidden="true" className="ml-auto size-3.5" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
