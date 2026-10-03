import { BrandMark } from "@/components/ui/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Desktop-only brand panel for the signed-out screens. Static and quiet by design. */
export function AuthAside({
  heading,
  description,
}: {
  heading: string;
  description: string;
}) {
  return (
    <aside className="hidden border-r bg-muted/40 lg:flex lg:flex-col lg:justify-between lg:p-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark size={36} />
          <span className="leading-tight">
            <span className="block text-sm font-semibold">
              Engineering Society
            </span>
            <span className="block text-xs text-muted-foreground">
              Committee workspace
            </span>
          </span>
        </div>
        <ThemeToggle />
      </div>
      <div className="max-w-sm">
        <p className="text-3xl font-semibold tracking-tight">{heading}</p>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Engineering Society Platform
      </p>
    </aside>
  );
}
