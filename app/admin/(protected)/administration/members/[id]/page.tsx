import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ErrorState } from "@/components/admin/error-state";
import { PermanentDeletionDialog } from "@/components/admin/permanent-deletion-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isUuid, requireSenior } from "@/lib/administration/access";
import { formatDay, formatWhen } from "@/lib/administration/labels";
import { getMember, type MemberDetail } from "@/lib/administration/server";
import { logServerError } from "@/lib/api/log";

export const dynamic = "force-dynamic";

const LEVELS: Record<string, string> = {
  COMMITTEE_MANAGER: "Committee Manager",
  BOARD_ADMIN: "Board Administration",
  TECHNICAL: "Technical Team",
};

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function MemberPage({
  params,
}: PageProps<"/admin/administration/members/[id]">) {
  const [{ id }, actor] = await Promise.all([params, requireSenior()]);
  if (!actor)
    return (
      <ErrorState
        title="Member records are for senior administrators"
        description="Board Administration and the Technical Team review member records here."
      />
    );
  if (!isUuid(id)) notFound();
  let detail: MemberDetail | null = null;
  try {
    const result = await getMember(actor.userId, id);
    if (result.code === "NOT_FOUND") notFound();
    if (result.code === "SUCCESS") detail = result as unknown as MemberDetail;
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    logServerError("administration_member_failed", error);
  }
  if (!detail)
    return (
      <ErrorState
        title="This member is unavailable"
        description="The record could not be loaded. Try again shortly."
      />
    );
  const { member, account, access } = detail;
  const self = member.id === actor.userId;

  return (
    <section aria-labelledby="member-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="member-title"
        title={member.name}
        description={`${member.email} · student ID ${member.universityId}`}
        context={
          <>
            <Badge
              variant={member.status === "graduate" ? "outline" : "secondary"}
            >
              {member.status === "graduate" ? "Graduate" : "Member"}
            </Badge>
            {access?.active ? (
              <Badge variant="outline">
                {LEVELS[access.level] ?? access.level}
              </Badge>
            ) : null}
            {detail.changeRequests.some((r) => r.status === "pending") ? (
              <Badge variant="outline">Correction pending</Badge>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 @4xl/main:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Membership</CardTitle>
            <CardDescription>
              The record approved from the SQU ID card. Corrections go through
              the membership page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                [
                  "Discipline",
                  <span key="d" className="capitalize">
                    {member.discipline ?? "—"}
                  </span>,
                ],
                ["Academic year", member.year ? `Year ${member.year}` : "—"],
                [
                  "Interests",
                  member.interests.length ? member.interests.join(", ") : "—",
                ],
                ["Photo", member.hasPhoto ? "Uploaded" : "None"],
                ["Member since", formatDay(member.createdAt)],
                ["Profile updated", formatWhen(member.updatedAt)],
              ]}
            />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Account &amp; access</CardTitle>
            <CardDescription>
              The sign-in identity is separate from membership and from
              dashboard access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                ["Sign-in email", account?.email ?? "No sign-in account"],
                [
                  "Email confirmed",
                  account ? (account.confirmed ? "Yes" : "No") : "—",
                ],
                ["Last sign-in", formatWhen(account?.lastSignInAt)],
                [
                  "Dashboard access",
                  access
                    ? `${LEVELS[access.level] ?? access.level}${access.committee ? ` · ${access.committee}` : ""}${access.active ? "" : access.revocationKind === "suspended" ? " (suspended)" : " (revoked)"}`
                    : "None",
                ],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 @4xl/main:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Committees</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {detail.committees.length === 0 ? (
              <p className="text-muted-foreground">
                Not on any committee roster.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {detail.committees.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/administration/committees/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {c.responsibility ? ` · ${c.responsibility}` : ""}
                      {c.archived ? " · archived" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {detail.projects.length === 0 ? (
              <p className="text-muted-foreground">No projects.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {detail.projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/admin/projects/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.title ?? "Untitled project"}
                    </Link>
                    <span className="text-muted-foreground">
                      {" "}
                      · {p.status.replace("_", " ")}
                      {p.published ? " · published" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event participation</CardTitle>
          <CardDescription>
            {detail.registrationCount} registration
            {detail.registrationCount === 1 ? "" : "s"}
            {detail.registrationCount > detail.registrations.length
              ? `, the latest ${detail.registrations.length} shown`
              : ""}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {detail.registrations.length === 0 ? (
            <p className="text-muted-foreground">No registrations.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {detail.registrations.map((r) => (
                <li
                  key={r.eventId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <Link
                    href={`/admin/events/${r.eventId}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {r.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {formatDay(r.eventDate)} · {r.status}
                    {r.attended ? " · attended" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert
              aria-hidden="true"
              className="size-4 text-destructive"
            />{" "}
            Permanent actions
          </CardTitle>
          <CardDescription>
            Membership suspension needs an approved society policy before it can
            be offered. Deletion shows everything affected and is blocked while
            projects or accountability records depend on it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {self ? (
            <p className="text-muted-foreground">
              You cannot delete your own records.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Delete the membership record.
                  </span>{" "}
                  Removes the membership, applications, ID cards, photo and
                  roster places. Registrations are anonymized. The sign-in
                  account stays.
                </p>
                <PermanentDeletionDialog
                  kind="membership"
                  id={member.id}
                  label="Delete membership"
                />
              </div>
              {actor.accessLevel === "TECHNICAL" && account ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="max-w-xl text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Delete the account completely.
                    </span>{" "}
                    Everything above, plus the Supabase sign-in identity. Audit
                    entries stay without anything identifying the person.
                    Technical Team only.
                  </p>
                  <PermanentDeletionDialog
                    kind="account"
                    id={member.id}
                    label="Delete account"
                  />
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
