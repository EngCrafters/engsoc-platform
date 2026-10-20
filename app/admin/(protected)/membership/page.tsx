import Link from "next/link";
import { after } from "next/server";
import { ArrowRight, Inbox, ShieldAlert } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import {
  getMembershipAccess,
  listMembershipApplications,
  parseMembershipFilter,
  processMembershipStorageDeletions,
} from "@/lib/membership/server";
import {
  decodeMembershipCursor,
  encodeMembershipCursor,
} from "@/lib/membership/cursor";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { POLICY_LABELS, REVIEWER_LABELS } from "@/lib/membership/labels";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { MembershipFilters } from "@/components/admin/membership-filters";
import { MembershipList } from "@/components/admin/membership-list";
import { MembershipUnavailable } from "@/components/admin/membership-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MembershipPolicyForm } from "./policy-form";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

export default async function MembershipApplicationsPage({
  searchParams,
}: PageProps<"/admin/membership">) {
  const query = await searchParams;
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager)) {
    return <MembershipUnavailable reason={access.reason} />;
  }
  if (access.kind !== "reviewer") {
    return (
      <p role="alert">
        Membership applications are reviewed by Society Affairs and Senior
        Management only.
      </p>
    );
  }

  const { overview } = access;
  // Retries any ID card deletion an earlier decision could not finish.
  after(() => processMembershipStorageDeletions());
  const filter = parseMembershipFilter(single(query.status));
  const rawSearch = single(query.q)?.trim().slice(0, 100) || null;
  const view = { filter, query: rawSearch };
  const cursorResult = decodeMembershipCursor(single(query.cursor), view);
  const { items, nextCursor } = cursorResult.invalid
    ? { items: [], nextCursor: null }
    : await listMembershipApplications(manager.userId, {
        ...view,
        cursor: cursorResult.cursor,
      });
  const { counts } = overview;
  const awaiting = counts.pending_review + counts.verified;

  return (
    <section aria-labelledby="membership-title" className="flex flex-col gap-6">
      <AdminPageHeader
        title="Membership applications"
        headingId="membership-title"
        description="Verify applicants against their SQU ID card, then approve or reject. Approved applicants are invited to create their member account."
        context={
          <>
            <Badge variant="secondary">
              {REVIEWER_LABELS[overview.reviewer]} reviewer
            </Badge>
            <span className="text-sm text-muted-foreground tabular-nums">
              {awaiting} awaiting a decision
              {counts.activationPending > 0
                ? ` · ${counts.activationPending} activation pending`
                : ""}
            </span>
          </>
        }
      />

      {overview.policy === null ? (
        <Alert>
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Final approval is not enabled yet</AlertTitle>
          <AlertDescription>
            The owner has not confirmed the approval policy. You can review,
            verify and reject applications; approval and account activation stay
            disabled until the Technical Team records the decision.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Approval policy:</span>{" "}
          {POLICY_LABELS[overview.policy]}
        </p>
      )}

      {manager.accessLevel === "TECHNICAL" ? (
        <MembershipPolicyForm policy={overview.policy} />
      ) : null}

      <MembershipFilters
        filter={filter}
        query={rawSearch}
        counts={{
          pending_review: counts.pending_review,
          verified: counts.verified,
          approved: counts.approved,
          rejected: counts.rejected,
        }}
      >
        {cursorResult.invalid ? (
          <Alert variant="destructive">
            <AlertTitle>This page link is invalid</AlertTitle>
            <AlertDescription>
              Return to the first page and try again.
            </AlertDescription>
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={rawSearch ? "No matching applications" : "Nothing here"}
            description={
              rawSearch
                ? "Try another name, email or student ID, or another status."
                : filter === "pending_review"
                  ? "New membership applications appear here as students submit them on the website."
                  : "No applications have this status."
            }
          />
        ) : (
          <>
            <MembershipList items={items} />
            {nextCursor ? (
              <nav
                className="flex justify-end"
                aria-label="Application list pagination"
              >
                <Button asChild variant="outline">
                  <Link
                    href={(() => {
                      const params = new URLSearchParams();
                      if (filter !== "pending_review")
                        params.set("status", filter);
                      if (rawSearch) params.set("q", rawSearch);
                      params.set(
                        "cursor",
                        encodeMembershipCursor(nextCursor, view)
                      );
                      return `/admin/membership?${params.toString()}`;
                    })()}
                  >
                    Next applications
                    <ArrowRight aria-hidden="true" data-icon="inline-end" />
                  </Link>
                </Button>
              </nav>
            ) : null}
          </>
        )}
      </MembershipFilters>
    </section>
  );
}
