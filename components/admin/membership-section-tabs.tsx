import Link from "next/link";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { key: "applications", href: "/admin/membership", label: "Applications" },
  {
    key: "verifications",
    href: "/admin/membership/verifications",
    label: "SQU verification",
  },
  {
    key: "leadership",
    href: "/admin/membership/leadership",
    label: "Leadership",
  },
] as const;
export type MembershipSection = (typeof SECTIONS)[number]["key"];

/**
 * The three review queues of the membership section (ADR 0025), as links so
 * each queue keeps its own URL, filters and pagination. The counts are items
 * waiting for a decision.
 */
export function MembershipSectionTabs({
  current,
  counts,
}: {
  current: MembershipSection;
  counts: Record<MembershipSection, number>;
}) {
  return (
    <nav
      aria-label="Membership review queues"
      className="-mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0"
    >
      <ul className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-muted p-[3px] text-muted-foreground">
        {SECTIONS.map((section) => {
          const active = section.key === current;
          return (
            <li key={section.key} className="h-full">
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active &&
                    "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                )}
              >
                {section.label}
                <span className="text-muted-foreground tabular-nums">
                  {counts[section.key]}
                  <span className="sr-only"> waiting</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
