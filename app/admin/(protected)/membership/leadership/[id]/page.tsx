import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BadgeCheck, CircleSlash, TriangleAlert, Undo2 } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import { getMembershipAccess } from "@/lib/membership/server";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { formatEventDate } from "@/lib/events/format";
import { getLeadershipRequest } from "@/lib/verification/review";
import {
  CANCELLATION_LABELS,
  TEAM_STATUS_LABELS,
  VERIFICATION_HISTORY_LABELS,
  leadershipPath,
  teamName,
} from "@/lib/verification/labels";
import { AdminPageHeader } from "@/components/admin/page-header";
import { MembershipUnavailable } from "@/components/admin/membership-unavailable";
import { ReviewActionDialog } from "@/components/admin/review-action-dialog";
import { LeadershipStatusBadge } from "@/components/admin/verification-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  decideLeadershipAction,
  revokeAppointmentAction,
} from "../../verification-actions";

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

export default async function LeadershipRequestPage({
  params,
}: PageProps<"/admin/membership/leadership/[id]">) {
  const [{ id }, manager] = await Promise.all([params, getManagerContext()]);
  if (manager.kind !== "manager") return null;
  if (!UUID.test(id)) notFound();
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager))
    return <MembershipUnavailable reason={access.reason} />;
  const result =
    access.kind === "reviewer"
      ? await getLeadershipRequest(manager.userId, id)
      : ({ code: "FORBIDDEN" } as const);
  if (result.code === "FORBIDDEN")
    return (
      <p role="alert">This request is outside your leadership permissions.</p>
    );
  if (result.code !== "SUCCESS") notFound();
  const { request, team, member, appointment, own } = result;
  const seeMembers = can(manager, "members.view");
  const institution = member.institution?.en ?? member.institutionName;
  const full =
    result.maxHolders !== null && result.holders.length >= result.maxHolders;
  const pending = request.status === "pending";
  // ADR 0026: committee-level leadership has no team.
  const scopeName = team
    ? `${team.name.en}, ${request.committee.name}`
    : `${request.committee.name} (committee level)`;

  return (
    <section
      aria-labelledby="leadership-request-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        headingId="leadership-request-title"
        title={member.name}
        description={`Requests ${request.position.label.en} of ${scopeName}.`}
        context={
          <>
            <LeadershipStatusBadge status={request.status} />
            <span className="text-sm text-muted-foreground">
              Submitted {when(request.submittedAt)}
            </span>
          </>
        }
      />

      {own ? (
        <Alert>
          <AlertTitle>This is your own request</AlertTitle>
          <AlertDescription>Another reviewer must decide it.</AlertDescription>
        </Alert>
      ) : null}
      {result.stale ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>The structure changed</AlertTitle>
          <AlertDescription>
            {team
              ? "The team moved, is no longer active, or its committee was archived after this request."
              : "The committee was archived after this request."}{" "}
            It cannot be approved; reject it so the member can request again.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
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
              <Field label="Member since">{when(member.memberSince)}</Field>
              <Field label="Current positions">
                {result.memberAppointments.length === 0
                  ? "None"
                  : result.memberAppointments
                      .map((a) =>
                        leadershipPath(a.committee, a.team, a.position)
                      )
                      .join("; ")}
              </Field>
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
            <CardTitle>Requested position</CardTitle>
            <CardDescription>
              The committee, the level (committee or team) and the position, as
              the member chose them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <Field label="Committee">
                {request.committee.name}
                {request.committee.archived ? " (archived)" : ""}
              </Field>
              <Field label="Level">
                {team ? "Team leadership" : "Committee leadership"}
              </Field>
              {team ? (
                <Field label="Team">
                  {teamName(team.name)}{" "}
                  {team.status !== "active" ? (
                    <Badge variant="outline" className="ms-1">
                      {TEAM_STATUS_LABELS[team.status]}
                    </Badge>
                  ) : null}
                  {team.committee.id !== request.committee.id ? (
                    <span className="block text-xs text-muted-foreground">
                      Now under {team.committee.name}
                    </span>
                  ) : null}
                </Field>
              ) : null}
              <Field label="Position">{request.position.label.en}</Field>
              <Field label="Current holders">
                {result.holders.length === 0
                  ? "Vacant"
                  : result.holders.map((h) => h.name).join(", ")}
                <span className="block text-xs text-muted-foreground">
                  {result.maxHolders === null
                    ? "No limit"
                    : `Limit ${result.maxHolders} per ${team ? "team" : "committee"}`}
                  {full && pending ? " · full: approval will be refused" : ""}
                </span>
              </Field>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          <CardDescription>
            The leader receives the dashboard permissions configured for this
            committee or team under Administration → Permissions, if any. Nobody
            decides their own request.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="flex flex-col gap-3">
            {request.decidedAt ? (
              <Field
                label={
                  request.status === "cancelled"
                    ? "Closed"
                    : request.status === "approved"
                      ? "Approved"
                      : "Rejected"
                }
              >
                {when(request.decidedAt)}
                {request.decidedByEmail ? ` by ${request.decidedByEmail}` : ""}
              </Field>
            ) : null}
            {request.cancellationReason ? (
              <Field label="Why">
                {CANCELLATION_LABELS[request.cancellationReason] ??
                  request.cancellationReason}
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
            {appointment ? (
              <Field label="Appointment">
                {appointment.active
                  ? `Active · ${appointment.position.label.en}`
                  : `Ended ${when(appointment.endedAt)}${appointment.endedByEmail ? ` by ${appointment.endedByEmail}` : ""}`}
                {appointment.endReason ? (
                  <span className="block text-xs text-muted-foreground">
                    Reason shown to the member: {appointment.endReason}
                  </span>
                ) : null}
                {appointment.endNote ? (
                  <span className="block text-xs text-muted-foreground">
                    Internal note: {appointment.endNote}
                  </span>
                ) : null}
              </Field>
            ) : null}
          </dl>
          {own || !result.canDecide ? null : (
            <div className="flex flex-wrap gap-4">
              {pending ? (
                <>
                  <ReviewActionDialog
                    action={decideLeadershipAction}
                    hidden={{
                      requestId: request.id,
                      revision: String(request.revision),
                      decision: "approve",
                    }}
                    icon={
                      <BadgeCheck aria-hidden="true" data-icon="inline-start" />
                    }
                    label="Approve"
                    title="Approve this appointment?"
                    description={`${member.name} becomes ${request.position.label.en} of ${scopeName}. It appears on their profile, and they receive the dashboard permissions configured for this committee or team, if any.`}
                    successText="Appointment approved"
                    variant="default"
                    disabled={result.stale}
                    hint={
                      result.stale
                        ? "The structure changed; reject this request instead."
                        : full
                          ? "This position is full; approval will be refused until a holder changes."
                          : undefined
                    }
                  />
                  <ReviewActionDialog
                    action={decideLeadershipAction}
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
                    title="Reject this request?"
                    description="The member sees the reason and may request again, within the request limit."
                    reason={{ label: "Reason for the member", required: true }}
                    successText="Request rejected"
                    variant="destructive"
                  />
                </>
              ) : null}
              {appointment?.active ? (
                <ReviewActionDialog
                  action={revokeAppointmentAction}
                  hidden={{
                    appointmentId: appointment.id,
                    revision: String(appointment.revision),
                    returnPath: `/admin/membership/leadership/${request.id}`,
                  }}
                  icon={<Undo2 aria-hidden="true" data-icon="inline-start" />}
                  label="Revoke appointment"
                  title="Revoke this appointment?"
                  description="The position is freed and the member sees the reason on their profile. The appointment stays in the history."
                  reason={{ label: "Reason for the member", required: true }}
                  successText="Appointment revoked"
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
            The request and the appointment it created.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    {entry.action === "appointment.updated" &&
                    typeof entry.changes?.position === "string"
                      ? ` (${String(entry.changes.previousPosition).replace("_", " ")} → ${entry.changes.position.replace("_", " ")})`
                      : ""}
                    <span className="text-muted-foreground">
                      {" · "}
                      {entry.actorEmail ?? "the member"}
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
