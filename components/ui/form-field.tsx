import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * Shared field wrapper: label (+ required mark) above control, description
 * or error below. See docs/DESIGN_SYSTEM.md "Forms". Not bound to any form
 * library — this codebase drives forms with `useActionState`, so pass
 * `error` from the action state and wire `aria-describedby` on the control
 * yourself using the `{htmlFor}-description` / `{htmlFor}-error` ids below.
 */
export function FormField({
  htmlFor,
  label,
  required,
  description,
  error,
  children,
  className,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
  description?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <FormMessage id={`${htmlFor}-error`}>{error}</FormMessage>
      ) : description ? (
        <FormDescription id={`${htmlFor}-description`}>
          {description}
        </FormDescription>
      ) : null}
    </div>
  );
}

export function FormDescription({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className={cn("text-xs text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export function FormMessage({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={cn("text-xs font-medium text-destructive", className)}
    >
      {children}
    </p>
  );
}

export function FormActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("grid gap-3", className)}>{children}</div>;
}
