import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isUuid, requirePermission } from "@/lib/administration/access";
import {
  getPermissionGroup,
  type PermissionGroup,
} from "@/lib/administration/permissions";
import { logServerError } from "@/lib/api/log";
import { PermissionsEditor } from "./permissions-editor";

export const dynamic = "force-dynamic";

/** One committee's or team's permissions (ADR 0027). */
export default async function PermissionGroupPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const [{ kind, id }, actor] = await Promise.all([
    params,
    requirePermission("permissions.manage"),
  ]);
  if (!actor)
    return (
      <ErrorState
        title="Permissions need the Manage permissions permission"
        description="Board Administration and Technical have it initially; they can give it to a committee or team."
      />
    );
  if ((kind !== "committee" && kind !== "team") || !isUuid(id)) notFound();
  let group: PermissionGroup | null = null;
  try {
    const result = await getPermissionGroup(actor.userId, kind, id);
    if ("group" in result) group = result;
    else if (result.code === "NOT_FOUND") notFound();
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    logServerError("permission_group_failed", error);
  }
  if (!group)
    return (
      <ErrorState
        title="These permissions are unavailable"
        description="They could not be loaded. Try again shortly."
      />
    );
  const { group: g } = group;
  const inactive =
    g.kind === "committee" ? g.committee.archived : g.status !== "active";

  return (
    <section
      aria-labelledby="permission-group-title"
      className="flex flex-col gap-6"
    >
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/administration/permissions">
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            All committees and teams
          </Link>
        </Button>
      </div>
      <AdminPageHeader
        headingId="permission-group-title"
        title={g.kind === "committee" ? g.name : `${g.name} (team)`}
        description={
          g.kind === "committee"
            ? "Permissions for this committee's own Chief and Assistant Chief and its Committee Manager. Its teams have their own permissions."
            : `A team of ${g.committee.name}. Its Chief and Assistant Chief receive these permissions only; the committee's permissions do not apply to them through the team.`
        }
        context={
          <>
            <Badge variant="outline">
              {g.kind === "committee" ? "Committee" : "Team"}
            </Badge>
            {g.nameAr ? (
              <span
                dir="rtl"
                lang="ar"
                className="text-sm text-muted-foreground"
              >
                {g.nameAr}
              </span>
            ) : null}
            {inactive ? (
              <Badge variant="outline">
                {g.kind === "committee" ? "Archived" : "Not active"}: grants
                nothing until it is active again
              </Badge>
            ) : null}
          </>
        }
      />
      <PermissionsEditor
        // A saved change reloads the page: start from the stored permissions again.
        key={JSON.stringify(group.permissions)}
        kind={g.kind}
        id={g.id}
        groupName={g.name}
        committeeName={g.committee.name}
        catalog={group.catalog}
        initial={group.permissions}
        holders={group.holders}
        history={group.history}
        self={group.self}
      />
    </section>
  );
}
