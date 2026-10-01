import { cn } from "@/lib/utils";

/**
 * Loading indicator — a faint full ring plus a rotating rounded-cap arc,
 * in `currentColor` so it matches whatever text color it's dropped into
 * (button label, muted text, etc). See docs/DESIGN_SYSTEM.md.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        className="opacity-20"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
