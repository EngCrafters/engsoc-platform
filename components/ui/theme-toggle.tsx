"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Theme toggle. `variant="shell"` styles the trigger for the dark navy
 * admin shell; the default styles it for a light `surface` background
 * (auth pages). See docs/DESIGN_SYSTEM.md "Theming".
 */
export function ThemeToggle({
  variant = "default",
}: {
  variant?: "default" | "shell";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDark = mounted && resolvedTheme === "dark";
  const label = mounted
    ? `Switch to ${isDark ? "light" : "dark"} mode`
    : "Change theme";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "flex items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        variant === "shell" ? "size-9" : "size-8",
        variant === "shell"
          ? "text-shell-foreground/85 hover:bg-shell-foreground/[0.08] hover:text-shell-foreground focus-visible:outline-shell-accent"
          : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring"
      )}
    >
      {mounted ? (
        isDark ? (
          <Sun
            aria-hidden="true"
            className={variant === "shell" ? "size-[1.125rem]" : "size-4"}
          />
        ) : (
          <Moon
            aria-hidden="true"
            className={variant === "shell" ? "size-[1.125rem]" : "size-4"}
          />
        )
      ) : (
        <span className={variant === "shell" ? "size-[1.125rem]" : "size-4"} />
      )}
    </button>
  );
}
