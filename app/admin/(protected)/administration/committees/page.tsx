import Link from "next/link";
import { Archive, Building2, Lock } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSenior } from "@/lib/administration/access";
import {
  listCommittees,
  type CommitteeSummary,
} from "@/lib/administration/server";
import { logServerError } from "@/lib/api/log";
import { CommitteeFormDialog } from "./committee-form";

export const dynamic = "force-dynamic";

export default async function CommitteesPage() {
  const actor = await requireSenior();
  if (!actor)
    return (
      <ErrorState
        title="Committees are managed by senior administrators"
        description="Board Administration and the Technical Team manage the committee catalog."
      />
    );
  let committees: CommitteeSummary[] | null = null;
  try {
    const result = await listCommittees(actor.userId);
    if (result.code === "SUCCESS")
      committees = result.committees as CommitteeSummary[];
  } catch (error) {
    logServerError("administration_committees_failed", error);
  }
  if (!committees)
    return (
      <ErrorState
        title="Committees are unavailable"
        description="The committee list could not be loaded. Try again shortly."
      />
    );
  const active = committees.filter((committee) => !committee.archivedAt).length;

  return (
    <section aria-labelledby="committees-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="committees-title"
        title="Committees"
        description={`${active} active, ${committees.length - active} archived. Committees are archived, never deleted, so their events and projects keep their owner.`}
        actions={<CommitteeFormDialog />}
      />
      {committees.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No committees yet"
          description="Create the first committee to assign managers and members."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[48rem]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Committee</TableHead>
                <TableHead>Managers</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Upcoming</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {committees.map((committee) => (
                <TableRow
                  key={committee.id}
                  className={
                    committee.archivedAt ? "text-muted-foreground" : undefined
                  }
                >
                  <TableCell className="max-w-72">
                    <Link
                      href={`/admin/administration/committees/${committee.id}`}
                      className="font-medium text-foreground hover:underline focus-visible:underline"
                    >
                      {committee.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {committee.description ?? committee.slug}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56">
                    {committee.managers.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <span
                        className="block truncate"
                        title={committee.managers
                          .map((m) => m.email)
                          .join(", ")}
                      >
                        {committee.managers.map((m) => m.email).join(", ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {committee.members}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {committee.upcomingEvents}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {committee.events}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {committee.projects}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {committee.archivedAt ? (
                        <Badge variant="outline">
                          <Archive aria-hidden="true" /> Archived
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                      {committee.protected ? (
                        <Badge
                          variant="outline"
                          title="Other workflows name this committee; it cannot be archived."
                        >
                          <Lock aria-hidden="true" /> Workflow
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
