import Link from "next/link";
import {
  ArrowRight,
  Building2,
  KeyRound,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePermission } from "@/lib/administration/access";
import {
  accessSummary,
  can,
  canAny,
  type PermissionKey,
} from "@/lib/auth/permissions";
import {
  adminOverview,
  listAccountErasures,
  type Overview,
  type PendingErasure,
} from "@/lib/administration/server";
import {
  activityLabel,
  actorLabel,
  formatWhen,
} from "@/lib/administration/labels";
import { logServerError } from "@/lib/api/log";
import { PendingErasures } from "./pending-erasures";

export const dynamic = "force-dynamic";

const SECTIONS: ReadonlyArray<{
  href: string;
  title: string;
  description: string;
  icon: typeof Building2;
  /** Shown when the person holds this permission in any scope. */
  permission: PermissionKey;
}> = [
  {
    href: "/admin/administration/permissions",
    title: "Permissions",
    description:
      "What each committee and team may do; affected leaders and history.",
    icon: ShieldCheck,
    permission: "permissions.manage",
  },
  {
    href: "/admin/administration/committees",
    title: "Committees",
    description: "Catalog, descriptions, managers, rosters and archive.",
    icon: Building2,
    permission: "committees.view",
  },
  {
    href: "/admin/access",
    title: "Accounts & access",
    description: "Invite administrators, assign roles, suspend and reactivate.",
    icon: KeyRound,
    permission: "accounts.view",
  },
  {
    href: "/admin/administration/members",
    title: "Members",
    description:
      "Search members, review their records, delete with safeguards.",
    icon: Users,
    permission: "members.view",
  },
  {
    href: "/admin/membership",
    title: "Membership applications",
    description: "Review, approve and correct verified details.",
    icon: UserCheck,
    permission: "membership.view",
  },
];

export default async function AdministrationPage() {
  // The overview needs committees.view (ADR 0027); each area below needs its own permission.
  const actor = await requirePermission("committees.view");
  if (!actor)
    return (
      <ErrorState
        title="Administration needs the View committees permission"
        description="Committees, accounts and members are shown to people whose permissions include them."
      />
    );
  let overview: Overview | null = null;
  let erasures: PendingErasure[] = [];
  try {
    const result = await adminOverview(actor.userId);
    if (result.code === "SUCCESS") overview = result as unknown as Overview;
    if (can(actor, "accounts.erase")) {
      const pending = await listAccountErasures(actor.userId);
      erasures = (pending.erasures as PendingErasure[] | undefined) ?? [];
    }
  } catch (error) {
    logServerError("administration_overview_failed", error);
  }
  if (!overview)
    return (
      <ErrorState
        title="Administration is unavailable"
        description="The overview could not be loaded. If the database has not been migrated to schema 32 yet, apply migration 0032 first."
      />
    );

  const stats = [
    {
      label: "Committees",
      value: overview.committees.active,
      hint: `${overview.committees.archived} archived`,
    },
    {
      label: "Administrators",
      value:
        overview.access.technical +
        overview.access.board +
        overview.access.managers,
      hint: `${overview.access.technical} Technical · ${overview.access.board} Board · ${overview.access.managers} managers`,
    },
    {
      label: "Members",
      value: overview.members.total,
      hint: `${overview.members.graduates} graduates`,
    },
    {
      label: "Awaiting decisions",
      value: overview.applications + overview.corrections,
      hint: `${overview.applications} applications · ${overview.corrections} corrections`,
    },
  ];

  return (
    <section
      aria-labelledby="administration-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        headingId="administration-title"
        title="Administration"
        description="Committees, accounts, permissions and members in one place. Every change is checked by the database and recorded in the audit."
        context={
          <Badge variant="secondary">{accessSummary(actor.access)}</Badge>
        }
      />

      <div className="grid grid-cols-2 gap-4 @3xl/main:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm" className="min-w-0">
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">
                {stat.value}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <nav
        aria-label="Administration areas"
        className="grid gap-3 @2xl/main:grid-cols-2"
      >
        {SECTIONS.filter((section) => canAny(actor, section.permission)).map(
          ({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{title}</span>
                <span className="text-sm text-muted-foreground">
                  {description}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          )
        )}
      </nav>

      {overview.access.suspended > 0 ||
      overview.storageCleanup > 0 ||
      erasures.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              Work that is safe to leave, but should not be forgotten.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {overview.access.suspended > 0 ? (
              <p>
                <span className="font-medium tabular-nums">
                  {overview.access.suspended}
                </span>{" "}
                suspended access{" "}
                {overview.access.suspended === 1 ? "grant" : "grants"}.{" "}
                <Link
                  href="/admin/access"
                  className="underline underline-offset-4"
                >
                  Review accounts
                </Link>
              </p>
            ) : null}
            {overview.storageCleanup > 0 ? (
              <p>
                <span className="font-medium tabular-nums">
                  {overview.storageCleanup}
                </span>{" "}
                {overview.storageCleanup === 1 ? "file is" : "files are"} queued
                for deletion from private storage. The queue retries
                automatically.
              </p>
            ) : null}
            {erasures.length > 0 ? (
              <PendingErasures erasures={erasures} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recent administration</CardTitle>
            <CardDescription>
              Committee, access and deletion activity, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No administrative activity yet.
              </p>
            ) : (
              <ol className="flex flex-col divide-y">
                {overview.recent.map((row) => (
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
                      {actorLabel(row)}
                      {row.committee ? ` · ${row.committee}` : ""} ·{" "}
                      {formatWhen(row.occurredAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-4" /> Permissions
            </CardTitle>
            <CardDescription>
              Access comes from personal levels (Board Administration,
              Technical, Committee Manager) and from the permissions assigned to
              each committee and team, which their active Chiefs and Assistant
              Chiefs receive. The database enforces every permission.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              <span className="text-muted-foreground">Your access: </span>
              {accessSummary(actor.access)} ·{" "}
              <span className="tabular-nums">
                {Object.keys(actor.access.permissions).length}
              </span>{" "}
              permissions
            </p>
            {can(actor, "permissions.manage") ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="self-start"
              >
                <Link href="/admin/administration/permissions">
                  Manage committee and team permissions
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        Events {overview.events.live} live · {overview.events.draft} drafts ·{" "}
        {overview.events.archived} archived. Projects {overview.projects.total}{" "}
        ({overview.projects.published} published, {overview.projects.inReview}{" "}
        in review).{" "}
        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
          <Link href="/admin/events">Open events</Link>
        </Button>
      </p>
    </section>
  );
}
