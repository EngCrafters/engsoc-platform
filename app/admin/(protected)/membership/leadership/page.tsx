import Link from "next/link";
import { ChevronRight, ShieldCheck, Users } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { can, canAny } from "@/lib/auth/permissions";
import { getMembershipAccess, EMPTY_COUNTS } from "@/lib/membership/server";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { formatEventDate } from "@/lib/events/format";
import {
  LEADERSHIP_FILTERS,
  REVIEW_PAGE_SIZE,
  getVerificationSettings,
  leadershipFilterOptions,
  listLeadershipRequests,
  parseDay,
  parseOffset,
  type LeadershipFilter,
} from "@/lib/verification/review";
import {
  LEADERSHIP_STATUS_LABELS,
  TEAM_STATUS_LABELS,
  VERIFICATION_REVIEWERS_SENTENCE,
  leadershipPath,
} from "@/lib/verification/labels";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { MembershipSectionTabs } from "@/components/admin/membership-section-tabs";
import { MembershipUnavailable } from "@/components/admin/membership-unavailable";
import {
  ReviewQueueControls,
  ReviewQueuePagination,
} from "@/components/admin/review-queue-controls";
import { LeadershipStatusBadge } from "@/components/admin/verification-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerificationSettingsCard } from "../verification-settings";
import { LeadershipRequestsSwitch } from "../leadership-requests-switch";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const single = (value: string | string[] | undefined) =>
  Array.isArray(value) ? undefined : value;
const uuidOrNull = (value: string | undefined) =>
  value && UUID.test(value) ? value : null;
const selectClass = "h-9 rounded-md border bg-background px-3 text-sm";

/**
 * Committee leadership requests (ADR 0025), for leadership reviewers: Board
 * Administration and Society Affairs. Technical reaches this page through the
 * membership section and sees only the settings it manages.
 */
export default async function LeadershipRequestsPage({
  searchParams,
}: PageProps<"/admin/membership/leadership">) {
  const query = await searchParams;
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager))
    return <MembershipUnavailable reason={access.reason} />;
  // The queue needs leadership.view (any committee; it lists the ones in scope); the switch and the
  // settings, settings.verification (ADR 0027).
  const reviewer = canAny(manager, "leadership.view") ? "reviewer" : null;
  const settingsHolder = can(manager, "settings.verification");
  if (!reviewer && !settingsHolder)
    return (
      <p role="alert">
        Leadership requests need the View leadership requests permission.
      </p>
    );

  const status = (LEADERSHIP_FILTERS as readonly string[]).includes(
    single(query.status) ?? ""
  )
    ? (single(query.status) as LeadershipFilter)
    : "pending";
  const q = single(query.q)?.trim().slice(0, 100) || null;
  const committee = uuidOrNull(single(query.committee));
  const team = uuidOrNull(single(query.team));
  const fromText = single(query.from);
  const toText = single(query.to);
  const offset = parseOffset(single(query.offset));
  const params = {
    status,
    q,
    committee,
    team,
    from: parseDay(fromText) ? fromText : null,
    to: parseDay(toText) ? toText : null,
  };
  const [list, filters, settings] = await Promise.all([
    reviewer
      ? listLeadershipRequests(manager.userId, {
          status,
          committee,
          team,
          query: q,
          from: parseDay(fromText),
          to: parseDay(toText, true),
          offset,
        })
      : null,
    reviewer ? leadershipFilterOptions(manager.userId) : null,
    getVerificationSettings(manager.userId),
  ]);
  const counts =
    access.kind === "reviewer" ? access.overview.counts : EMPTY_COUNTS;

  return (
    <section aria-labelledby="leadership-title" className="flex flex-col gap-6">
      <AdminPageHeader
        title="Committee leadership"
        headingId="leadership-title"
        description="Members request a Chief or Assistant Chief position for a committee, or for one of its teams. Approval records the appointment on their profile; the leader then receives the dashboard permissions configured for that committee or team, if any."
        context={
          <Badge variant="secondary">
            {canAny(manager, "leadership.review")
              ? "Reviewer"
              : reviewer
                ? "View only"
                : "Settings only"}
          </Badge>
        }
      />
      <MembershipSectionTabs
        current="leadership"
        counts={{
          applications: counts.pending_review + counts.verified,
          verifications: counts.squPending ?? 0,
          leadership: counts.leadershipPending ?? 0,
        }}
      />
      {settings ? (
        <LeadershipRequestsSwitch
          open={settings.leadershipRequestsOpen}
          editable={settingsHolder}
        />
      ) : null}
      {!reviewer ? (
        <EmptyState
          icon={ShieldCheck}
          title="Not a leadership reviewer"
          description={VERIFICATION_REVIEWERS_SENTENCE}
        />
      ) : (
        <>
          <ReviewQueueControls
            basePath="/admin/membership/leadership"
            label="Leadership requests"
            statuses={LEADERSHIP_FILTERS.map((value) => ({
              value,
              label: value === "all" ? "All" : LEADERSHIP_STATUS_LABELS[value],
            }))}
            params={params}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="leadership-committee">Committee</Label>
              <select
                id="leadership-committee"
                name="committee"
                defaultValue={committee ?? ""}
                className={selectClass}
              >
                <option value="">All committees</option>
                {(filters ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="leadership-team">Team</Label>
              <select
                id="leadership-team"
                name="team"
                defaultValue={team ?? ""}
                className={selectClass}
              >
                <option value="">All levels and teams</option>
                {(filters ?? []).map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.status !== "active"
                          ? ` (${TEAM_STATUS_LABELS[t.status as keyof typeof TEAM_STATUS_LABELS]?.toLowerCase() ?? t.status})`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </ReviewQueueControls>
          {!list ? (
            <ErrorState
              title="Leadership requests are unavailable"
              description="They could not be loaded. Try again shortly."
            />
          ) : list.items.length === 0 ? (
            <EmptyState
              icon={Users}
              title={
                q || committee || team || params.from || params.to
                  ? "No matching requests"
                  : "Nothing here"
              }
              description={
                status === "pending"
                  ? settings && !settings.leadershipRequestsOpen
                    ? "New requests are closed. Open them above to let members request positions from their profile."
                    : "Requests appear here when members ask for a committee or team position from their profile."
                  : "No requests have this status."
              }
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Position
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        Submitted
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-px">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.items.map((item) => {
                      const path = leadershipPath(
                        item.committee.name,
                        item.team,
                        item.position
                      );
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="w-full max-w-0 whitespace-normal md:w-auto md:max-w-none md:min-w-52">
                            <Link
                              href={`/admin/membership/leadership/${item.id}`}
                              className="block truncate font-medium hover:underline focus-visible:underline"
                            >
                              {item.name}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground lg:hidden">
                              {path}
                            </p>
                            <p
                              className="hidden truncate text-xs text-muted-foreground lg:block"
                              dir="ltr"
                            >
                              {item.email}
                            </p>
                          </TableCell>
                          <TableCell className="hidden max-w-72 whitespace-normal lg:table-cell">
                            {path}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {formatEventDate(new Date(item.submittedAt))}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <LeadershipStatusBadge status={item.status} />
                              {item.own ? (
                                <span className="text-xs text-muted-foreground">
                                  Your own request
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button asChild variant="ghost" size="sm">
                              <Link
                                href={`/admin/membership/leadership/${item.id}`}
                                aria-label={`Review ${item.name}`}
                              >
                                <span className="hidden sm:inline">Review</span>
                                <ChevronRight
                                  aria-hidden="true"
                                  data-icon="inline-end"
                                />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <ReviewQueuePagination
                basePath="/admin/membership/leadership"
                params={{
                  ...params,
                  status: status === "pending" ? null : status,
                }}
                offset={offset}
                total={list.total}
                pageSize={REVIEW_PAGE_SIZE}
                label="Leadership requests"
              />
            </>
          )}
        </>
      )}
      {settings ? (
        <VerificationSettingsCard
          settings={settings}
          editable={settingsHolder}
        />
      ) : null}
    </section>
  );
}
