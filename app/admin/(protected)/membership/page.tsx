import Link from "next/link";
import { after } from "next/server";
import { ArrowRight, Inbox, ShieldAlert } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import {
  defaultMembershipFilter,
  getAccountActivationSetting,
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
import {
  ACCOUNT_ACTIVATION_LABELS,
  POLICY_LABELS,
} from "@/lib/membership/labels";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { MembershipFilters } from "@/components/admin/membership-filters";
import { MembershipList } from "@/components/admin/membership-list";
import { MembershipSectionTabs } from "@/components/admin/membership-section-tabs";
import { MembershipUnavailable } from "@/components/admin/membership-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MembershipPolicyForm } from "./policy-form";
import { AccountActivationForm } from "./account-activation-form";
import { ProfileCorrections } from "./corrections";
import { profileChangeRequests } from "@/lib/members/profile";
import { logServerError } from "@/lib/api/log";

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
  if (access.kind !== "reviewer" || !can(manager, "membership.view")) {
    return (
      <p role="alert">
        Membership applications need the View applications permission.
      </p>
    );
  }

  const { overview } = access;
  // Retries any ID card deletion an earlier decision could not finish.
  after(() => processMembershipStorageDeletions());
  const automatic = overview.policy === "automatic";
  const defaultFilter = defaultMembershipFilter(overview.policy);
  const filter = parseMembershipFilter(single(query.status), defaultFilter);
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
  const activation = await getAccountActivationSetting();

  return (
    <section aria-labelledby="membership-title" className="flex flex-col gap-6">
      <AdminPageHeader
        title="Membership applications"
        headingId="membership-title"
        description={
          automatic
            ? "Students, graduates, academics, professionals and others register on the website and are approved automatically. Each member account becomes active when its owner confirms their email. Applications from before automatic approval can still be approved or rejected here."
            : "Students, graduates, academics, professionals and others apply here. Check the details, then approve or reject. Approved applicants are invited to create their member account."
        }
        context={
          <>
            <Badge variant="secondary">
              {!can(manager, "membership.review")
                ? "View only"
                : overview.reviewer === "senior"
                  ? "Reviewer with final approval"
                  : "Reviewer"}
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

      <MembershipSectionTabs
        current="applications"
        counts={{
          applications: awaiting,
          verifications: counts.squPending ?? 0,
          leadership: counts.leadershipPending ?? 0,
        }}
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
      <p className="-mt-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Account activation:</span>{" "}
        {ACCOUNT_ACTIVATION_LABELS[activation.accountActivation].title}
        {activation.accountActivation === "immediate" &&
        !activation.canCreateAccounts
          ? " (unavailable on this server, so registrants confirm their email)"
          : null}
      </p>

      {can(manager, "settings.membership_policy") ? (
        <>
          <MembershipPolicyForm policy={overview.policy} />
          <AccountActivationForm
            current={activation.accountActivation}
            canCreateAccounts={activation.canCreateAccounts}
          />
        </>
      ) : null}

      <ProfileCorrections
        requests={
          (await profileChangeRequests(manager.userId).catch((error) => {
            // Never let corrections take the applications page down.
            logServerError("profile_corrections_unavailable", error);
            return null;
          })) ?? []
        }
        result={single(query.corrections)?.slice(0, 40)}
      />

      <MembershipFilters
        filter={filter}
        defaultFilter={defaultFilter}
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
                : filter === defaultFilter
                  ? automatic
                    ? "New members appear here as people register on the website."
                    : "New membership applications appear here as people submit them on the website."
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
                      if (filter !== defaultFilter)
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
