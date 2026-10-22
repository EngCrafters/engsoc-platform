import Link from "next/link";
import { Search, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  listMembers,
  type MemberFilter,
  type MemberRow,
} from "@/lib/administration/server";
import { logServerError } from "@/lib/api/log";

export const dynamic = "force-dynamic";

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "member", label: "Members" },
  { value: "graduate", label: "Graduates" },
  { value: "admin", label: "With dashboard access" },
];
const PAGE = 30;
const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? undefined : value;
const LEVELS: Record<string, string> = {
  COMMITTEE_MANAGER: "Manager",
  BOARD_ADMIN: "Board",
  TECHNICAL: "Technical",
};

export default async function MembersPage({
  searchParams,
}: PageProps<"/admin/administration/members">) {
  const actor = await requireSenior();
  if (!actor)
    return (
      <ErrorState
        title="The member directory is for senior administrators"
        description="Board Administration and the Technical Team review member records here."
      />
    );
  const query = await searchParams;
  const search = (one(query.q) ?? "").slice(0, 100);
  const filter = (FILTERS.find((f) => f.value === one(query.filter))?.value ??
    "all") as MemberFilter;
  const page = Math.max(
    1,
    Math.min(1000, Number.parseInt(one(query.page) ?? "1", 10) || 1)
  );
  let rows: MemberRow[] | null = null;
  let total = 0;
  try {
    const result = await listMembers(
      actor.userId,
      search,
      filter,
      (page - 1) * PAGE
    );
    if (result.code === "SUCCESS") {
      rows = result.members as MemberRow[];
      total = Number(result.total);
    }
  } catch (error) {
    logServerError("administration_members_failed", error);
  }
  if (!rows)
    return (
      <ErrorState
        title="The member directory is unavailable"
        description="Members could not be loaded. Try again shortly."
      />
    );
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (next: Partial<{ q: string; filter: string; page: number }>) => {
    const params = new URLSearchParams();
    const q = next.q ?? search;
    const f = next.filter ?? filter;
    if (q) params.set("q", q);
    if (f !== "all") params.set("filter", f);
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    const text = params.toString();
    return `/admin/administration/members${text ? `?${text}` : ""}`;
  };

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="members-title"
        title="Members"
        description="Every approved member. Open a member to see their record, committees, events and projects, or to delete it with safeguards."
      />
      <div className="flex flex-col gap-3">
        <form
          role="search"
          action="/admin/administration/members"
          className="flex flex-wrap items-center gap-2"
        >
          {filter !== "all" ? (
            <input type="hidden" name="filter" value={filter} />
          ) : null}
          <Input
            name="q"
            defaultValue={search}
            maxLength={100}
            placeholder="Search by name, email or student ID"
            aria-label="Search members"
            className="max-w-sm"
          />
          <Button type="submit" variant="outline">
            <Search data-icon="inline-start" aria-hidden="true" /> Search
          </Button>
        </form>
        <nav aria-label="Filter members" className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              asChild
              size="sm"
              variant={filter === option.value ? "secondary" : "ghost"}
            >
              <Link
                href={href({ filter: option.value })}
                aria-current={filter === option.value ? "page" : undefined}
              >
                {option.label}
              </Link>
            </Button>
          ))}
        </nav>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            search || filter !== "all" ? "No members match" : "No members yet"
          }
          description={
            search || filter !== "all"
              ? "Try another search or filter."
              : "Members appear here once their applications are approved."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[52rem]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Discipline</TableHead>
                  <TableHead>Committees</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Projects</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="max-w-64">
                      <Link
                        href={`/admin/administration/members/${member.id}`}
                        className="block truncate font-medium hover:underline focus-visible:underline"
                      >
                        {member.name}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {member.universityId}
                    </TableCell>
                    <TableCell className="capitalize">
                      {member.discipline ?? "—"}
                      {member.year ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · Year {member.year}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="max-w-48 truncate"
                      title={member.committees.join(", ")}
                    >
                      {member.committees.length ? (
                        member.committees.join(", ")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {member.registrations}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {member.projects}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Badge
                          variant={
                            member.status === "graduate"
                              ? "outline"
                              : "secondary"
                          }
                        >
                          {member.status === "graduate" ? "Graduate" : "Member"}
                        </Badge>
                        {member.adminLevel ? (
                          <Badge variant="outline">
                            {LEVELS[member.adminLevel]}
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav
            aria-label="Member pages"
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="text-muted-foreground tabular-nums">
              {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ page: page - 1 })}>Previous</Link>
                </Button>
              ) : null}
              {page < pages ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ page: page + 1 })}>Next</Link>
                </Button>
              ) : null}
            </span>
          </nav>
        </>
      )}
    </section>
  );
}
