import { cn } from "@/lib/utils";

/**
 * Two soft, blurred monochrome blobs for a `glass` Card to sit over — a
 * `backdrop-blur` on a flat background blurs nothing visible, so any glass
 * surface needs one of these (or similar) behind it. Place on a `relative`
 * ancestor; purely decorative. See docs/DESIGN_SYSTEM.md "Card variants".
 */
export function AmbientGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className
      )}
    >
      <div className="absolute -top-20 -left-20 size-72 rounded-full bg-foreground/[0.07] blur-3xl dark:bg-foreground/[0.05]" />
      <div className="absolute top-1/3 -right-24 size-80 rounded-full bg-foreground/[0.05] blur-3xl dark:bg-foreground/[0.07]" />
      <div className="absolute -bottom-24 left-1/4 size-64 rounded-full bg-foreground/[0.06] blur-3xl dark:bg-foreground/[0.04]" />
    </div>
  );
}
