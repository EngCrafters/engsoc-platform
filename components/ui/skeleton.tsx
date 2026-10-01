import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_ease-in-out_infinite] after:bg-gradient-to-r after:from-transparent after:via-foreground/10 after:to-transparent",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
