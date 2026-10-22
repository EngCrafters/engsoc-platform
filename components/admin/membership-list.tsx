import Link from "next/link";
import { ChevronRight, FileCheck2, UserCheck } from "lucide-react";
import { MembershipStatusBadge } from "@/components/admin/membership-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEventDate } from "@/lib/events/format";
import { disciplineLabel } from "@/lib/membership/labels";
import type { MembershipListItem } from "@/lib/membership/server";

const cell = "group-data-[density=compact]/admin:py-1.5";

function Row({ item }: { item: MembershipListItem }) {
  const submitted = formatEventDate(new Date(item.submittedAt));
  return (
    <TableRow>
      <TableCell
        className={`${cell} w-full max-w-0 whitespace-normal md:w-auto md:max-w-none md:min-w-52`}
      >
        <Link
          href={`/admin/membership/${item.id}`}
          className="block truncate font-medium hover:underline focus-visible:underline"
        >
          {item.fullName}
        </Link>
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {item.email}
          <span className="md:hidden"> · {submitted}</span>
        </p>
      </TableCell>
      <TableCell className={`${cell} hidden whitespace-normal lg:table-cell`}>
        <p className="tabular-nums" dir="ltr">
          {item.universityId}
        </p>
        <p className="max-w-56 truncate text-xs text-muted-foreground">
          {disciplineLabel(item.discipline)} · Year {item.academicYear}
        </p>
      </TableCell>
      <TableCell className={`${cell} hidden md:table-cell`}>
        {submitted}
      </TableCell>
      <TableCell className={cell}>
        <div className="flex flex-col items-start gap-1">
          <MembershipStatusBadge status={item.status} />
          {item.status === "approved" ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <UserCheck aria-hidden="true" className="size-3" />
              {item.activated ? "Account active" : "Activation pending"}
            </span>
          ) : item.hasDocument ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileCheck2 aria-hidden="true" className="size-3" />
              ID card attached
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className={`${cell} text-right`}>
        <Button asChild variant="ghost" size="sm">
          <Link
            href={`/admin/membership/${item.id}`}
            aria-label={`Review ${item.fullName}`}
          >
            <span className="hidden sm:inline">Review</span>
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function MembershipList({ items }: { items: MembershipListItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead className="hidden lg:table-cell">Student ID</TableHead>
            <TableHead className="hidden md:table-cell">Submitted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-px">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
