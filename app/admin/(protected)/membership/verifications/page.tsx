import Link from "next/link";
import { after } from "next/server";
import { ChevronRight, FileCheck2, IdCard, ShieldCheck } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import { getMembershipAccess, EMPTY_COUNTS } from "@/lib/membership/server";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { formatEventDate } from "@/lib/events/format";
import {
  REVIEW_PAGE_SIZE,
  SQU_FILTERS,
  getVerificationSettings,
  listSquVerifications,
  parseDay,
  parseOffset,
  purgeExpiredVerificationDocuments,
  type SquFilter,
} from "@/lib/verification/review";
import {
  SQU_STATE_LABELS,
  VERIFICATION_REVIEWERS_SENTENCE,
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
import { SquStateBadge } from "@/components/admin/verification-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerificationSettingsCard } from "../verification-settings";

export const dynamic = "force-dynamic";

const single = (value: string | string[] | undefined) =>
  Array.isArray(value) ? undefined : value;

/**
 * SQU student verification requests (ADR 0025), for Board Administration and
 * Society Affairs. Technical reaches this page through the membership section
 * (it reviews applications) and sees only the settings it manages.
 */
export default async function SquVerificationsPage({
  searchParams,
}: PageProps<"/admin/membership/verifications">) {
  const query = await searchParams;
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager))
    return <MembershipUnavailable reason={access.reason} />;
  // The queue needs squ.view; the settings below, settings.verification (ADR 0027).
  const reviewer = can(manager, "squ.view") ? "reviewer" : null;
  const settingsHolder = can(manager, "settings.verification");
  if (!reviewer && !settingsHolder)
    return (
      <p role="alert">
        SQU student verification needs the View SQU verification permission.
      </p>
    );

  // Retention cleanup: nothing happens until a period is configured.
  if (reviewer) after(() => purgeExpiredVerificationDocuments(manager.userId));
  const status = (SQU_FILTERS as readonly string[]).includes(
    single(query.status) ?? ""
  )
    ? (single(query.status) as SquFilter)
    : "pending";
  const q = single(query.q)?.trim().slice(0, 100) || null;
  const fromText = single(query.from);
  const toText = single(query.to);
  const offset = parseOffset(single(query.offset));
  const params = {
    status,
    q,
    from: parseDay(fromText) ? fromText : null,
    to: parseDay(toText) ? toText : null,
  };
  const [list, settings] = await Promise.all([
    reviewer
      ? listSquVerifications(manager.userId, {
          state: status,
          query: q,
          from: parseDay(fromText),
          to: parseDay(toText, true),
          offset,
        })
      : null,
    getVerificationSettings(manager.userId),
  ]);
  const counts =
    access.kind === "reviewer" ? access.overview.counts : EMPTY_COUNTS;

  return (
    <section aria-labelledby="squ-title" className="flex flex-col gap-6">
      <AdminPageHeader
        title="SQU student verification"
        headingId="squ-title"
        description="Members who say they study at Sultan Qaboos University submit their student number and SQU ID card. Verification is optional and separate from membership and from dashboard access."
        context={
          <Badge variant="secondary">
            {can(manager, "squ.review")
              ? "Reviewer"
              : reviewer
                ? "View only"
                : "Settings only"}
          </Badge>
        }
      />
      <MembershipSectionTabs
        current="verifications"
        counts={{
          applications: counts.pending_review + counts.verified,
          verifications: counts.squPending ?? 0,
          leadership: counts.leadershipPending ?? 0,
        }}
      />
      {!reviewer ? (
        <EmptyState
          icon={ShieldCheck}
          title="Not a verification reviewer"
          description={VERIFICATION_REVIEWERS_SENTENCE}
        />
      ) : (
        <>
          <ReviewQueueControls
            basePath="/admin/membership/verifications"
            label="SQU verification requests"
            statuses={SQU_FILTERS.map((value) => ({
              value,
              label: value === "all" ? "All" : SQU_STATE_LABELS[value],
            }))}
            params={params}
          />
          {!list ? (
            <ErrorState
              title="Verification requests are unavailable"
              description="They could not be loaded. Try again shortly."
            />
          ) : list.items.length === 0 ? (
            <EmptyState
              icon={IdCard}
              title={
                q || params.from || params.to
                  ? "No matching requests"
                  : "Nothing here"
              }
              description={
                status === "pending"
                  ? "New SQU verification requests appear here when members submit them from their profile."
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
                    {list.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="w-full max-w-0 whitespace-normal md:w-auto md:max-w-none md:min-w-52">
                          <Link
                            href={`/admin/membership/verifications/${item.id}`}
                            className="block truncate font-medium hover:underline focus-visible:underline"
                          >
                            {item.name}
                          </Link>
                          <p
                            className="truncate text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            {item.email}
                          </p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {formatEventDate(new Date(item.submittedAt))}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <SquStateBadge state={item.state} />
                            {item.own ? (
                              <span className="text-xs text-muted-foreground">
                                Your own request
                              </span>
                            ) : item.hasDocument ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <FileCheck2
                                  aria-hidden="true"
                                  className="size-3"
                                />
                                Evidence attached
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              href={`/admin/membership/verifications/${item.id}`}
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
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ReviewQueuePagination
                basePath="/admin/membership/verifications"
                params={{
                  ...params,
                  status: status === "pending" ? null : status,
                }}
                offset={offset}
                total={list.total}
                pageSize={REVIEW_PAGE_SIZE}
                label="Verification requests"
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
