import type { ReactNode } from "react";

/** A titled group of related fields. Sections are separated by rules, not cards. */
export function EventFormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 py-6 first:pt-0 last:pb-0 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  );
}
