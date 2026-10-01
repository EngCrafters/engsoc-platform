import Link from "next/link";
import {
  Building2,
  Check,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const managerCan = [
  "Create, edit, and publish events in your committees, subject to review.",
  "Approve a draft flagged by another manager in the same committee.",
  "View registrations and export event-scoped CSV files.",
];

const managerCannot = [
  "Manage a committee without an active grant.",
  "Grant, revoke, or change committee access, including your own.",
  "Delete events, alter audit history, or export platform-wide data.",
];

const maintenanceOnly = [
  "Provision accounts and committee-manager access.",
  "Reset system passwords or change platform settings.",
  "Transfer operational ownership.",
];

function ListWithIcon({
  items,
  icon: Icon,
  tone,
}: {
  items: string[];
  icon: typeof Check;
  tone: string;
}) {
  return (
    <ul className="grid gap-2.5">
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-2.5 text-sm leading-5 text-foreground/90"
        >
          <Icon aria-hidden="true" className={`mt-1 size-4 shrink-0 ${tone}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function AccountOverview({
  email,
  userId,
  committees,
  logoutAction,
  compact = false,
  idPrefix = "account",
}: {
  email: string | null;
  userId: string;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
  compact?: boolean;
  idPrefix?: string;
}) {
  return (
    <div>
      {!compact ? (
        <AdminPageHeader
          eyebrow="Account"
          title="Account & security"
          headingId="account-title"
          description="Your sign-in identity, active committee access, and security options."
        />
      ) : null}

      <div
        className={cn(
          "grid gap-5",
          compact
            ? "gap-4"
            : "mt-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"
        )}
      >
        <Card
          role="region"
          aria-labelledby={`${idPrefix}-identity-title`}
          className="gap-0 shadow-panel"
        >
          <CardHeader>
            <CardTitle
              id={`${idPrefix}-identity-title`}
              className="flex items-center gap-2"
            >
              <UserRound aria-hidden="true" className="size-4" />
              Signed in as
            </CardTitle>
            <CardDescription>
              Sign-in identity · separate from member profiles
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Email address
              </p>
              <p
                data-testid="account-email"
                className="break-all text-base font-semibold tracking-tight"
              >
                {email ?? "No email on this account"}
              </p>
            </div>
            <div>
              <Badge variant="primary-soft">Committee manager</Badge>
            </div>
            <div className="border-t border-border pt-3 sm:col-span-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Account ID
              </p>
              <p
                data-testid="account-user-id"
                className="break-all font-mono text-xs text-muted-foreground"
              >
                {userId}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          role="region"
          aria-labelledby={`${idPrefix}-scope-title`}
          className="gap-0 shadow-panel"
        >
          <CardHeader>
            <CardTitle
              id={`${idPrefix}-scope-title`}
              className="flex items-center gap-2"
            >
              <Building2 aria-hidden="true" className="size-4" />
              Committee scope
            </CardTitle>
            <CardDescription>
              Active grants, checked on every request
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ul data-testid="account-scopes" className="grid gap-2">
              {committees.map((committee) => (
                <li
                  key={committee.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {committee.name}
                  </span>
                  <Badge variant="success">Active</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Revoked grants stop access to that committee immediately.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card
        className={cn("gap-0 shadow-panel", compact ? "mt-4" : "mt-5")}
        role="region"
        aria-labelledby={`${idPrefix}-role-title`}
      >
        <CardHeader>
          <CardTitle
            id={`${idPrefix}-role-title`}
            className="flex items-center gap-2"
          >
            <ShieldCheck aria-hidden="true" className="size-4" />
            Role and permissions
          </CardTitle>
          <CardDescription>
            This committee manager account is not a platform-wide owner or
            super-admin role. The application has no such role.
          </CardDescription>
        </CardHeader>
        <CardContent
          className={cn(
            "grid gap-6 border-t border-border pt-5",
            !compact && "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-8"
          )}
        >
          <section aria-labelledby={`${idPrefix}-can-title`}>
            <h3
              id={`${idPrefix}-can-title`}
              className="mb-3 text-sm font-semibold"
            >
              Committee managers can
            </h3>
            <ListWithIcon items={managerCan} icon={Check} tone="text-success" />
          </section>
          <div
            className={cn(
              "grid content-start gap-3",
              !compact && "md:border-l md:border-border md:pl-8"
            )}
          >
            <details className="group rounded-lg border border-border px-4 py-3">
              <summary
                id={`${idPrefix}-cannot-title`}
                className="cursor-pointer text-sm font-semibold marker:text-muted-foreground"
              >
                Committee manager limits
              </summary>
              <div className="mt-4 border-t border-border pt-4">
                <ListWithIcon
                  items={managerCannot}
                  icon={X}
                  tone="text-muted-foreground"
                />
              </div>
            </details>
            <details className="group rounded-lg border border-border px-4 py-3">
              <summary
                id={`${idPrefix}-maintenance-title`}
                className="cursor-pointer text-sm font-semibold marker:text-muted-foreground"
              >
                Needs maintenance authority
              </summary>
              <div className="mt-4 border-t border-border pt-4">
                <ListWithIcon
                  items={maintenanceOnly}
                  icon={Wrench}
                  tone="text-muted-foreground"
                />
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Platform maintenance manages hosting and database accounts.
                  They work outside this application; these controls cannot
                  grant or change their access.
                </p>
              </div>
            </details>
          </div>
        </CardContent>
      </Card>

      <Card
        className={cn("gap-0 shadow-panel", compact ? "mt-4" : "mt-5")}
        role="region"
        aria-labelledby={`${idPrefix}-security-title`}
      >
        <CardHeader>
          <CardTitle
            id={`${idPrefix}-security-title`}
            className="flex items-center gap-2"
          >
            <KeyRound aria-hidden="true" className="size-4" />
            Password & recovery
          </CardTitle>
          <CardDescription>
            Recovery changes your sign-in password only. It never changes which
            committees you can manage.
          </CardDescription>
        </CardHeader>
        <CardContent
          className={cn(
            "flex flex-col gap-5 border-t border-border pt-5",
            !compact && "md:flex-row md:items-end md:justify-between"
          )}
        >
          <div className="max-w-2xl text-sm leading-6 text-muted-foreground">
            <p>
              Use a unique password of at least 12 characters. Recovery email is
              sent when an account matches; the page does not reveal whether one
              does.
            </p>
            <p className="mt-2">
              If you lose inbox access or committee access changes, contact
              platform maintenance. Sign out on shared devices.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button asChild variant="outline" className="h-11 px-4">
              <Link href="/admin/recovery">
                <KeyRound aria-hidden="true" />
                Reset password
              </Link>
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" className="h-11 px-4">
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
