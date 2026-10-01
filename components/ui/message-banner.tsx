import { forwardRef, type ComponentProps } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared success/error banner — icon + role="status"/"alert", built from
 * the same success/danger tokens as everything else. Used by the auth
 * shell (as `AuthMessage`) and the public registration form.
 *
 * Forwards its ref to the root element (the one carrying role="alert"/
 * "status") so callers that focus the banner on error — `ref={errorRef}`
 * + `tabIndex={-1}` — focus the actual alert, not a wrapper around it.
 */
export const MessageBanner = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & { tone: "error" | "success" }
>(function MessageBanner({ tone, children, className, ...props }, ref) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      ref={ref}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-lg border p-3 text-sm leading-6 duration-200 animate-in fade-in-0 outline-none",
        tone === "error"
          ? "border-danger/30 bg-danger-soft text-danger-soft-foreground"
          : "border-success/30 bg-success-soft text-success-soft-foreground",
        className
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
});
