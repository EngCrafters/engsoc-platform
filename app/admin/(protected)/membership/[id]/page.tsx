import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getManagerContext } from "@/lib/auth/manager";
import {
  getMembershipAccess,
  getMembershipApplication,
  listMembershipHistory,
} from "@/lib/membership/server";
import {
  disciplineLabel,
  interestLabel,
  REVIEWER_LABELS,
} from "@/lib/membership/labels";
import { formatEventDate } from "@/lib/events/format";
import { AdminPageHeader } from "@/components/admin/page-header";
import { MembershipStatusBadge } from "@/components/admin/membership-status-badge";
import { MembershipUnavailable } from "@/components/admin/membership-unavailable";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentViewer } from "./document-viewer";
import { ReviewActions } from "./review-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HISTORY_LABELS: Record<string, string> = {
  "membership.submitted": "Application submitted",
  "membership.document_viewed": "ID card viewed",
  "membership.verified": "Verified",
  "membership.approved": "Approved (ID card deleted)",
  "membership.rejected": "Rejected (ID card deleted)",
  "membership.activated": "Membership activated",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

const when = (iso: string | null) =>
  iso ? formatEventDate(new Date(iso)) : null;

export default async function MembershipApplicationPage({
  params,
}: PageProps<"/admin/membership/[id]">) {
  const [{ id }, manager] = await Promise.all([params, getManagerContext()]);
  if (manager.kind !== "manager") return null;
  if (!UUID.test(id)) notFound();
  // Shared with the layout's check for this request; the routine below still
  // re-checks the actor's access itself.
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager)) {
    return <MembershipUnavailable reason={access.reason} />;
  }
  const result =
    access.kind === "reviewer"
      ? await getMembershipApplication(manager.userId, id)
      : ({ code: "FORBIDDEN" } as const);
  if (result.code === "FORBIDDEN") {
    return (
      <p role="alert">
        Membership applications are reviewed by Society Affairs and Senior
        Management only.
      </p>
    );
  }
  if (result.code !== "SUCCESS") notFound();
  const { application: app, reviewer, policy, ownApplication } = result;
  const history = await listMembershipHistory(manager.userId, id);

  return (
    <section
      aria-labelledby="membership-application-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        headingId="membership-application-title"
        title={app.fullName}
        description="Check the details against the SQU ID card before deciding."
        context={
          <>
            <MembershipStatusBadge status={app.status} />
            <span className="text-sm text-muted-foreground">
              Submitted {when(app.submittedAt)}
            </span>
            {app.status === "approved" ? (
              <Badge variant="outline">
                {app.activatedAt ? "Account active" : "Activation pending"}
              </Badge>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Applicant</CardTitle>
            <CardDescription>As submitted on the website.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <Field label="Full name">{app.fullName}</Field>
              <Field label="SQU email">
                <span dir="ltr">{app.email}</span>
              </Field>
              <Field label="Student ID">
                <span dir="ltr" className="tabular-nums">
                  {app.universityId}
                </span>
              </Field>
              <Field label="Academic year">Year {app.academicYear}</Field>
              <Field label="Discipline">
                {disciplineLabel(app.discipline)}
              </Field>
              <Field label="Interests">
                {app.interests.length > 0
                  ? app.interests.map(interestLabel).join(", ")
                  : "None selected"}
              </Field>
              <Field label="Consent">
                Accepted {when(app.consentAcceptedAt)} (wording{" "}
                {app.consentVersion})
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SQU ID card</CardTitle>
            <CardDescription>
              Evidence for manual review only. Deleted at the final decision.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ownApplication ? (
              <p className="text-sm text-muted-foreground">
                Not available for your own application.
              </p>
            ) : app.document ? (
              <DocumentViewer
                applicationId={app.id}
                mediaType={app.document.mediaType}
                byteSize={app.document.byteSize}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {app.documentDeletedAt
                  ? `Deleted ${when(app.documentDeletedAt)}, after the decision.`
                  : "No document is stored."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>
            You review as {REVIEWER_LABELS[reviewer]}. Membership grants no
            committee or administrative access.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="flex flex-col gap-3">
            {app.verifiedAt ? (
              <Field label="Verified">
                {when(app.verifiedAt)} by {app.verifiedByEmail ?? "a reviewer"}
              </Field>
            ) : null}
            {app.decidedAt ? (
              <Field
                label={app.status === "approved" ? "Approved" : "Rejected"}
              >
                {when(app.decidedAt)} by {app.decidedByEmail ?? "a reviewer"}
              </Field>
            ) : null}
            {app.decisionNote ? (
              <Field label="Internal note">
                <span className="whitespace-pre-wrap">{app.decisionNote}</span>
              </Field>
            ) : null}
            {app.activatedAt ? (
              <Field label="Activated">{when(app.activatedAt)}</Field>
            ) : null}
          </dl>
          <ReviewActions
            applicationId={app.id}
            revision={app.revision}
            status={app.status}
            activated={Boolean(app.activatedAt)}
            reviewer={reviewer}
            policy={policy}
            verifiedByMe={app.verifiedBy === manager.userId}
            ownApplication={ownApplication}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>
            Every action on this application, including each view of the ID
            card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded actions.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {history.map((entry, index) => (
                <li
                  key={`${entry.occurredAt}-${index}`}
                  className="grid gap-0.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
                >
                  <span className="text-muted-foreground">
                    {when(entry.occurredAt)}
                  </span>
                  <span>
                    {HISTORY_LABELS[entry.action] ?? entry.action}
                    <span className="text-muted-foreground">
                      {" · "}
                      {entry.actorKind === "anonymous"
                        ? "applicant"
                        : (entry.actorEmail ?? "a reviewer")}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
