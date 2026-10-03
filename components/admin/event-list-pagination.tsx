import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EventListPagination({ nextHref }: { nextHref: string | null }) {
  if (!nextHref) return null;
  return (
    <nav className="flex justify-end" aria-label="Event list pagination">
      <Button asChild variant="outline">
        <Link href={nextHref}>
          Next 20 events
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </Button>
    </nav>
  );
}
