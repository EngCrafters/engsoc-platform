import Link from "next/link";
import { ArrowRight, Building2, Crown, ShieldCheck, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePermission } from "@/lib/administration/access";
import {
  listPermissionGroups,
  type CatalogEntry,
  type GroupPermission,
  type PermissionGroups,
} from "@/lib/administration/permissions";
import { ACCESS_LEVEL_LABELS } from "@/lib/auth/permissions";
import { logServerError } from "@/lib/api/log";

export const dynamic = "force-dynamic";

/** "Full access", "No permissions" or "5 permissions (2 for its own committee)". */
function summary(set: GroupPermission[], catalog: CatalogEntry[]) {
  if (set.length === 0) return { text: "No permissions", full: false };
  const full =
    set.length === catalog.length && set.every((p) => p.scope === "all");
  if (full) return { text: "Full access", full: true };
  const own = set.filter((p) => p.scope === "own").length;
  return {
    text: `${set.length} permission${set.length === 1 ? "" : "s"}${own ? ` (${own} for its own committee)` : ""}`,
    full: false,
  };
}

function GroupLink({
  href,
  label,
  set,
  catalog,
}: {
  href: string;
  label: string;
  set: GroupPermission[];
  catalog: CatalogEntry[];
}) {
  const s = summary(set, catalog);
  return (
    <Link
      href={href}
      aria-label={`Edit permissions of ${label}`}
      className="inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
    >
      <Badge
        variant={s.full ? "default" : set.length ? "secondary" : "outline"}
      >
        {s.text}
      </Badge>
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/**
 * Administration → Permissions (ADR 0027): what each committee and each team may do in the
 * dashboard. Their active Chiefs and Assistant Chiefs receive it (and a committee's Committee
 * Manager receives the committee's). Teams never inherit from their committee.
 */
export default async function PermissionsPage() {
  const actor = await requirePermission("permissions.manage");
  if (!actor)
    return (
      <ErrorState
        title="Permissions need the Manage permissions permission"
        description="Board Administration and Technical have it initially; they can give it to a committee or team."
      />
    );
  let data: PermissionGroups | null = null;
  try {
    data = await listPermissionGroups(actor.userId);
  } catch (error) {
    logServerError("permission_groups_failed", error);
  }
  if (!data)
    return (
      <ErrorState
        title="Permissions are unavailable"
        description="The permission configuration could not be loaded. Migration 0035 is required."
      />
    );
  const label = new Map(data.catalog.map((c) => [c.key, c.label]));

  return (
    <section
      aria-labelledby="permissions-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        headingId="permissions-title"
        title="Permissions"
        description="Choose what each committee and team may do in the dashboard. Approved, active Chiefs and Assistant Chiefs receive their committee's or team's permissions; pending requests and membership grant nothing. Teams have their own permissions and do not inherit the committee's."
      />

      {data.committees.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No committees"
          description="Create a committee under Administration → Committees first."
        />
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Committees and teams">
          {data.committees.map((committee) => (
            <li key={committee.id}>
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <Building2 aria-hidden="true" className="size-4" />
                    <span className="break-words">{committee.name}</span>
                    {committee.archived ? (
                      <Badge variant="outline">Archived: grants nothing</Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Crown aria-hidden="true" className="size-3.5" />
                      {committee.leaders} committee leader
                      {committee.leaders === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden="true" className="size-3.5" />
                      {committee.managers} Committee Manager
                      {committee.managers === 1 ? "" : "s"}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      Committee permissions
                    </span>
                    <GroupLink
                      href={`/admin/administration/permissions/committee/${committee.id}`}
                      label={committee.name}
                      set={committee.permissions}
                      catalog={data.catalog}
                    />
                  </div>
                  {committee.teams.length ? (
                    <ul
                      className="flex flex-col divide-y rounded-md border"
                      aria-label={`Teams of ${committee.name}`}
                    >
                      {committee.teams.map((team) => (
                        <li
                          key={team.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                            <span className="break-words">{team.name.en}</span>
                            {team.name.ar ? (
                              <span
                                dir="rtl"
                                lang="ar"
                                className="text-muted-foreground"
                              >
                                {team.name.ar}
                              </span>
                            ) : null}
                            {team.status !== "active" ? (
                              <Badge variant="outline">
                                Inactive: grants nothing
                              </Badge>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              {team.leaders} leader
                              {team.leaders === 1 ? "" : "s"}
                            </span>
                          </span>
                          <GroupLink
                            href={`/admin/administration/permissions/team/${team.id}`}
                            label={team.name.en}
                            set={team.permissions}
                            catalog={data.catalog}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No teams.</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-4" /> Personal
            access levels
          </CardTitle>
          <CardDescription>
            Granted per person under Accounts &amp; access. What each level
            includes is fixed by the database migration and cannot be edited
            here; a committee or team can be given the same or more.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 @3xl/main:grid-cols-3">
          {(["BOARD_ADMIN", "TECHNICAL", "COMMITTEE_MANAGER"] as const).map(
            (level) => (
              <section key={level} aria-label={ACCESS_LEVEL_LABELS[level]}>
                <h3 className="mb-2 text-sm font-medium">
                  {ACCESS_LEVEL_LABELS[level]}
                </h3>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {(data.levels[level] ?? []).map((p) => (
                    <li key={p.key}>
                      {label.get(p.key) ?? p.key}
                      {p.scope === "own" ? " (own committee)" : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </CardContent>
      </Card>
    </section>
  );
}
