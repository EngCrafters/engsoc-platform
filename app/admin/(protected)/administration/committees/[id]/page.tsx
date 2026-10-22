import { notFound } from "next/navigation";
import { Archive, Lock } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isUuid, requireSenior } from "@/lib/administration/access";
import {
  activityLabel,
  actorLabel,
  formatDay,
  formatWhen,
} from "@/lib/administration/labels";
import {
  getCommittee,
  type CommitteeDetail,
} from "@/lib/administration/server";
import { listAccess, listAuthDirectory } from "@/lib/access/server";
import { logServerError } from "@/lib/api/log";
import type { UserRecord } from "../../../access/user-types";
import { CommitteeFormDialog } from "../committee-form";
import { ArchiveControl } from "./archive-control";
import { CommitteeManagers } from "./committee-managers";
import { CommitteeRoster } from "./committee-roster";

export const dynamic = "force-dynamic";

export default async function CommitteePage({
  params,
}: PageProps<"/admin/administration/committees/[id]">) {
  const [{ id }, actor] = await Promise.all([params, requireSenior()]);
  if (!actor)
    return (
      <ErrorState
        title="Committees are managed by senior administrators"
        description="Board Administration and the Technical Team manage committees."
      />
    );
  if (!isUuid(id)) notFound();
  let detail: CommitteeDetail | null = null;
  let users: UserRecord[] = [];
  try {
    const [result, grants, directory] = await Promise.all([
      getCommittee(actor.userId, id),
      listAccess(actor.userId),
      listAuthDirectory(actor.userId),
    ]);
    if (result.code === "NOT_FOUND") notFound();
    if (result.code === "SUCCESS")
      detail = result as unknown as CommitteeDetail;
    const byUser = new Map(grants.map((grant) => [grant.user_id, grant]));
    users = directory.map((entry) => {
      const grant = byUser.get(entry.user_id);
      return {
        userId: entry.user_id,
        email: entry.email,
        emailConfirmed: entry.email_confirmed,
        invited: entry.invited,
        createdAt: new Date(entry.created_at).toISOString(),
        lastSignInAt: entry.last_sign_in_at
          ? new Date(entry.last_sign_in_at).toISOString()
          : null,
        access: grant
          ? {
              level: grant.access_level,
              committeeId: grant.committee_id,
              committeeName: grant.committee_name,
              active: grant.active,
              revocationKind: grant.revocation_kind,
            }
          : null,
      };
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    logServerError("administration_committee_failed", error);
  }
  if (!detail)
    return (
      <ErrorState
        title="This committee is unavailable"
        description="Its details could not be loaded. Try again shortly."
      />
    );
  const { committee, stats } = detail;
  const archived = Boolean(committee.archivedAt);

  return (
    <section aria-labelledby="committee-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="committee-title"
        title={committee.name}
        description={
          committee.description ?? "No responsibilities written yet."
        }
        context={
          <>
            <Badge variant="outline" className="font-mono">
              {committee.slug}
            </Badge>
            {archived ? (
              <Badge variant="outline">
                <Archive aria-hidden="true" /> Archived{" "}
                {formatDay(committee.archivedAt)}
              </Badge>
            ) : (
              <Badge variant="secondary">Active</Badge>
            )}
            {committee.protected ? (
              <Badge
                variant="outline"
                title="Membership, project or system workflows name this committee."
              >
                <Lock aria-hidden="true" /> Workflow committee
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <CommitteeFormDialog committee={committee} />
            <ArchiveControl
              committeeId={committee.id}
              name={committee.name}
              archived={archived}
              protectedCommittee={committee.protected}
            />
          </>
        }
      />

      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {[
          ["Events", stats.events],
          ["Live", stats.liveEvents],
          ["Upcoming", stats.upcomingEvents],
          ["Projects", stats.projects],
          ["Roster", detail.members.length],
        ].map(([label, value]) => (
          <div key={label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 @5xl/main:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Managers</CardTitle>
            <CardDescription>
              Committee access. Transferring leadership swaps managers in one
              step; history stays with each person.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CommitteeManagers
              committee={{ id: committee.id, name: committee.name }}
              archived={archived}
              managers={detail.managers}
              users={users}
              committees={actor.committees.filter((c) => !c.archived)}
              actorLevel={actor.accessLevel}
              currentUserId={actor.userId}
            />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Society members on this committee and their responsibilities.
              Being listed grants no dashboard access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CommitteeRoster
              committeeId={committee.id}
              archived={archived}
              members={detail.members}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Changes to this committee, its managers and its roster.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded changes yet.
            </p>
          ) : (
            <ol className="flex flex-col divide-y">
              {detail.activity.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-0.5 py-2.5 text-sm first:pt-0 last:pb-0"
                >
                  <span className="font-medium">
                    {activityLabel(row.action)}
                    {row.subject ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {row.subject}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {actorLabel(row)} · {formatWhen(row.occurredAt)}
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
