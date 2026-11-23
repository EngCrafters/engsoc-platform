import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BadgeCheck, CircleSlash, Undo2 } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import { getMembershipAccess } from "@/lib/membership/server";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { formatEventDate } from "@/lib/events/format";
import { getSquVerification } from "@/lib/verification/review";
import {
  SQU_STATE_LABELS,
  VERIFICATION_HISTORY_LABELS,
} from "@/lib/verification/labels";
import { AdminPageHeader } from "@/components/admin/page-header";
import { MembershipUnavailable } from "@/components/admin/membership-unavailable";
import { ReviewActionDialog } from "@/components/admin/review-action-dialog";
import { SquStateBadge } from "@/components/admin/verification-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentViewer } from "../../[id]/document-viewer";
import { decideSquAction, revokeSquAction } from "../../verification-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default async function SquVerificationPage({
  params,
}: PageProps<"/admin/membership/verifications/[id]">) {
  const [{ id }, manager] = await Promise.all([params, getManagerContext()]);
  if (manager.kind !== "manager") return null;
  if (!UUID.test(id)) notFound();
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager))
    return <MembershipUnavailable reason={access.reason} />;
  const result =
    access.kind === "reviewer"
      ? await getSquVerification(manager.userId, id)
      : ({ code: "FORBIDDEN" } as const);
  if (result.code === "FORBIDDEN")
    return (
      <p role="alert">
        SQU student verification needs the View SQU verification permission.
      </p>
    );
  if (result.code !== "SUCCESS") notFound();
  const { request, verification, member, own } = result;
  const seeMembers = can(manager, "members.view");
  const activeVerification =
    verification && !verification.revokedAt ? verification : null;
  const institution = member.institution?.en ?? member.institutionName ?? null;

  return (
    <section
      aria-labelledby="squ-request-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        headingId="squ-request-title"
        title={member.name}
        description="Check the student number and the SQU ID card. Verification records that this member is an SQU student; it does not change their membership or give any access."
        context={
          <>
            <SquStateBadge state={request.state} />
            <span className="text-sm text-muted-foreground">
              Submitted {when(request.submittedAt)}
            </span>
          </>
        }
      />

      {own ? (
        <Alert>
          <AlertTitle>This is your own request</AlertTitle>
          <AlertDescription>
            Another reviewer must decide it. Its evidence is not available to
            you.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Member</CardTitle>
            <CardDescription>From the member record.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <Field label="Name">{member.name}</Field>
              <Field label="Email">
                <span dir="ltr">{member.email}</span>
              </Field>
              <Field label="Category">
                {member.categoryLabel?.en ?? "Not recorded"}
              </Field>
              {institution ? (
                <Field label="Institution">{institution}</Field>
              ) : null}
              {member.universityId ? (
                <Field label="Student ID on record">
                  <span dir="ltr" className="tabular-nums">
                    {member.universityId}
                  </span>
                </Field>
              ) : null}
              <Field label="Member since">{when(member.memberSince)}</Field>
              {seeMembers ? (
                <Field label="Record">
                  <Link
                    href={`/admin/administration/members/${member.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    Open member record
                  </Link>
                </Field>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
            <CardDescription>
              Private. Kept after the decision unless a retention period is set.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="flex flex-col gap-3">
              <Field label="Student number">
                <span dir="ltr" className="font-mono tabular-nums">
                  {request.studentNumber}
                </span>
              </Field>
            </dl>
            {own ? (
              <p className="text-sm text-muted-foreground">
                Not available for your own request.
              </p>
            ) : request.document ? (
              <DocumentViewer
                applicationId={request.id}
                href={`/admin/membership/verifications/${request.id}/document`}
                mediaType={request.document.mediaType}
                byteSize={request.document.byteSize}
                subject="request"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {request.documentDeletedAt
                  ? `Removed ${when(request.documentDeletedAt)} under the retention period.`
                  : "No document is stored."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          <CardDescription>
            The member sees the status and any reason you give, never the
            internal note.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="flex flex-col gap-3">
            {request.decidedAt ? (
              <Field
                label={request.status === "approved" ? "Verified" : "Rejected"}
              >
                {when(request.decidedAt)} by{" "}
                {request.decidedByEmail ?? "a reviewer"}
              </Field>
            ) : null}
            {request.rejectionReason ? (
              <Field label="Reason shown to the member">
                <span className="whitespace-pre-wrap">
                  {request.rejectionReason}
                </span>
              </Field>
            ) : null}
            {request.reviewerNote ? (
              <Field label="Internal note">
                <span className="whitespace-pre-wrap">
                  {request.reviewerNote}
                </span>
              </Field>
            ) : null}
            {verification?.revokedAt ? (
              <>
                <Field label="Revoked">
                  {when(verification.revokedAt)} by{" "}
                  {verification.revokedByEmail ?? "a reviewer"}
                </Field>
                <Field label="Reason shown to the member">
                  <span className="whitespace-pre-wrap">
                    {verification.revocationReason}
                  </span>
                </Field>
                {verification.revocationNote ? (
                  <Field label="Internal note">
                    <span className="whitespace-pre-wrap">
                      {verification.revocationNote}
                    </span>
                  </Field>
                ) : null}
              </>
            ) : null}
          </dl>
          {own || !can(manager, "squ.review") ? null : (
            <div className="flex flex-wrap gap-4">
              {request.status === "pending" ? (
                <>
                  <ReviewActionDialog
                    action={decideSquAction}
                    hidden={{
                      requestId: request.id,
                      revision: String(request.revision),
                      decision: "approve",
                    }}
                    icon={
                      <BadgeCheck aria-hidden="true" data-icon="inline-start" />
                    }
                    label="Verify as SQU student"
                    title="Verify this member as an SQU student?"
                    description="The member's profile shows the SQU Verified badge. Their membership and access do not change. You are recorded as the reviewer."
                    successText="Member verified"
                    variant="default"
                  />
                  <ReviewActionDialog
                    action={decideSquAction}
                    hidden={{
                      requestId: request.id,
                      revision: String(request.revision),
                      decision: "reject",
                    }}
                    icon={
                      <CircleSlash
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                    }
                    label="Reject"
                    title="Reject this verification request?"
                    description="The member sees the reason and may submit corrected evidence, within the submission limit."
                    reason={{
                      label: "Reason for the member",
                      required: true,
                    }}
                    successText="Request rejected"
                    variant="destructive"
                  />
                </>
              ) : null}
              {activeVerification ? (
                <ReviewActionDialog
                  action={revokeSquAction}
                  hidden={{
                    verificationId: activeVerification.id,
                    requestId: request.id,
                  }}
                  icon={<Undo2 aria-hidden="true" data-icon="inline-start" />}
                  label="Revoke verification"
                  title="Revoke this SQU verification?"
                  description="The badge disappears from the member's profile and they see the reason. The verification stays in the history, and the member may submit again."
                  reason={{ label: "Reason for the member", required: true }}
                  successText="Verification revoked"
                  variant="destructive"
                />
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>
            Every action on this request, including each view of the evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {result.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded actions.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {result.history.map((entry, index) => (
                <li
                  key={`${entry.occurredAt}-${index}`}
                  className="grid gap-0.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
                >
                  <span className="text-muted-foreground">
                    {when(entry.occurredAt)}
                  </span>
                  <span>
                    {VERIFICATION_HISTORY_LABELS[entry.action] ?? entry.action}
                    <span className="text-muted-foreground">
                      {" · "}
                      {entry.actorEmail ?? "the member"}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {result.otherRequests.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                This member&apos;s other requests
              </h3>
              <ul className="flex flex-col gap-1 text-sm">
                {result.otherRequests.map((other) => (
                  <li key={other.id}>
                    <Link
                      href={`/admin/membership/verifications/${other.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {when(other.submittedAt)}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      ·{" "}
                      {other.status === "approved"
                        ? "Approved"
                        : SQU_STATE_LABELS[
                            other.status as keyof typeof SQU_STATE_LABELS
                          ]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
